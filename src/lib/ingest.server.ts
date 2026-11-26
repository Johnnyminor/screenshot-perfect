import { createCurrentsRequest, CurrentsQuotaError } from "./currents-request.server";
// Server-only collection. Scheduled and manual requests share this pipeline.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { buildMatches, canonicalizeUrl, normalizeHeadline } from "./triage";
import {
  parseFeed,
  parseTrials,
  parsePubmed,
  pubmedSearchSchema,
  type ParsedItem,
} from "./source-parsers";
import { approvedSourceUrl, publicSourceUrl, sourceSchema } from "./source-config";
import { fetchCurrentsSearch } from "./currents-search.server";
import { collectAnnouncements } from "./announcements.server";
import {
  fetchSource,
  readSourceBody as readBody,
  SourceHttpError,
  isAutomatedRequestBlock,
} from "./source-http.server";
import {
  GOOGLE_FEEDS_PER_RUN,
  isProviderCooling,
  nextPollAt,
  providerCooldown,
} from "./collection-policy";

type Admin = SupabaseClient<Database>;
type Feed = Database["public"]["Tables"]["feeds"]["Row"];
const UA = "LexNyhedsmonitor/1.0 (+https://lex.dk)";
class SourceYield extends Error {}
type SourceJob = {
  id: string;
  lease_token: string;
  cursor: { offset?: number; pageToken?: string; pages?: number; window?: string };
  created_at: string;
};
const MATCH_ALGORITHM = "triage-2";
const MAX_RUNTIME = 120_000; // Cooperative budget, below the six-minute dispatcher/job lease.

export async function checked<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }> & {
    abortSignal?: (
      signal: AbortSignal,
    ) => PromiseLike<{ data: T; error: { message: string } | null }>;
  },
): Promise<T> {
  const result = await (query.abortSignal?.(AbortSignal.timeout(20_000)) ?? query);
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function requireJobLease(
  query: PromiseLike<{ data: boolean | null; error: { message: string } | null }>,
) {
  if (!(await checked(query))) throw new Error("Kildejobbets lås er udløbet.");
}

export async function runIngest(
  admin: Admin,
  opts: {
    feedIds?: string[] | undefined;
    mode?: "ingest" | "rematch";
    trigger?: "manual" | "schedule";
  } = {},
) {
  const started = Date.now();
  const deadline = () => {
    if (Date.now() - started > MAX_RUNTIME)
      throw new SourceYield("Kørslen fortsættes ved næste tidsplankald.");
  };
  const mode = opts.mode ?? "ingest";
  const runId = await checked(
    admin.rpc("begin_collection", { p_mode: mode, p_trigger: opts.trigger ?? "manual" }),
  );
  if (!runId) throw new Error("Kørslen kunne ikke oprettes.");
  const log: {
    feed: string;
    status: string;
    seen?: number;
    items?: number;
    error?: string;
    next?: string;
  }[] = [];
  let ok = 0,
    failed = 0,
    newCount = 0,
    rematched = 0,
    deferred = 0;
  // Persist bounded progress, including before network calls. A terminated Worker cannot
  // execute finally; the next lease recovery must retain evidence already in the database.
  let checkpointQueue = Promise.resolve();
  const checkpoint = (stage: string) => {
    const pending = checkpointQueue.then(async () => {
      await checked(
        admin
          .from("ingest_runs")
          .update({
            feeds_ok: ok,
            feeds_failed: failed,
            feeds_deferred: deferred,
            items_new: newCount,
            log: [
              ...log,
              {
                feed: "collection",
                status: "progress",
                error: stage,
                next: new Date().toISOString(),
              },
            ] as Json,
          })
          .eq("id", runId)
          .eq("status", "running"),
      );
    });
    checkpointQueue = pending.catch(() => undefined);
    return pending;
  };
  try {
    await checkpoint("Loading configuration");
    if (mode === "rematch") await checked(admin.rpc("invalidate_matching"));
    const snapshot = (await checked(admin.rpc("matching_snapshot"))) as unknown as {
      revision: number;
      companies: Database["public"]["Tables"]["companies"]["Row"][];
      topics: Database["public"]["Tables"]["topics"]["Row"][];
      feeds: Feed[];
    };
    const { companies, topics, feeds: weights } = snapshot;
    const providers = await checked(admin.from("provider_health").select("*"));
    const weightMap = new Map((weights ?? []).map((feed) => [feed.id, Number(feed.source_weight)]));
    const ownerMap = new Map(
      (weights ?? [])
        .filter(
          (feed) =>
            feed.kind === "static" &&
            ["rss", "announcements"].includes(feed.connector) &&
            feed.company_id,
        )
        .map((feed) => [feed.id, feed.company_id]),
    );
    const matchesFor = (
      item: { headline: string; summary: string | null; published_at: string },
      weight: number,
      feedId?: string | null,
    ) =>
      buildMatches(
        companies ?? [],
        topics ?? [],
        item,
        weight,
        new Date(),
        feedId ? ownerMap.get(feedId) : undefined,
      );

    const providerMap = new Map((providers ?? []).map((state) => [state.hostname, state]));
    const providerSuccess = async (hostname: string) => {
      const state = {
        hostname,
        consecutive_failures: 0,
        blocked_until: null,
        last_error: null,
        last_status: 200,
        last_success_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await checked(admin.from("provider_health").upsert(state));
      providerMap.set(hostname, state);
    };
    const providerFailure = async (error: SourceHttpError) => {
      const previous = providerMap.get(error.hostname);
      const failures = (previous?.consecutive_failures ?? 0) + 1;
      const blocked_until = providerCooldown(error.hostname, error.status, failures, error.retryAt);
      const state = {
        hostname: error.hostname,
        consecutive_failures: failures,
        blocked_until,
        last_error: error.message,
        last_status: error.status,
        last_success_at: previous?.last_success_at ?? null,
        updated_at: new Date().toISOString(),
      };
      await checked(admin.from("provider_health").upsert(state));
      providerMap.set(error.hostname, state);
      return blocked_until;
    };
    const deferFeed = (feed: Feed, reason: string, next: string) => {
      deferred++;
      log.push({ feed: feed.name, status: "deferred", error: reason, next });
    };

    // Serialize NCBI requests across sources, below three requests per second.
    let ncbiQueue = Promise.resolve(),
      lastNcbiRequest = 0;
    const fetchNcbi = (url: string, accept: string): Promise<string> => {
      const result = ncbiQueue.then(async () => {
        const wait = Math.max(0, 1_000 - (Date.now() - lastNcbiRequest));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        deadline();
        lastNcbiRequest = Date.now();
        const target = new URL(url);
        target.searchParams.set("tool", "LexNyhedsmonitor");
        const apiKey = process.env["NCBI_API_KEY"];
        if (apiKey) target.searchParams.set("api_key", apiKey);
        else target.searchParams.delete("api_key");
        const email = process.env["NCBI_TOOL_EMAIL"];
        if (email) target.searchParams.set("email", email);
        const response = await fetchSource(
          target.href,
          { "User-Agent": UA, Accept: accept },
          { attempts: 3, deadline },
        );
        const body = await readBody(response);
        return body;
      });
      ncbiQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    let lastGoogleRequest = 0;
    const fetchGoogle = async (url: string, headers: Record<string, string>) => {
      const gap = Math.max(0, 3_000 - (Date.now() - lastGoogleRequest));
      if (gap) await new Promise((resolve) => setTimeout(resolve, gap));
      deadline();
      lastGoogleRequest = Date.now();
      return fetchSource(url, headers, { attempts: 2, deadline });
    };
    const processFeed = async (feed: Feed) => {
      const job = (await checked(
        admin.rpc("claim_source_job", { p_feed_id: feed.id, p_run_id: runId }),
      )) as unknown as SourceJob | null;
      if (!job) {
        deferFeed(feed, "Kilden har allerede et aktivt job.", nextPollAt(15));
        return;
      }
      const sourceStarted = Date.now();
      const sourceDeadline = () => {
        deadline();
        if (Date.now() - sourceStarted > 45_000)
          throw new SourceYield("Kildejobbet fortsættes senere.");
      };
      const saveCursor = async (cursor: SourceJob["cursor"]) => {
        if (
          !(await checked(
            admin.rpc("checkpoint_source_job", {
              p_id: job.id,
              p_token: job.lease_token,
              p_cursor: cursor,
            }),
          ))
        )
          throw new Error("Kildejobbets lås er udløbet.");
        job.cursor = cursor;
      };
      let jobStatus: "completed" | "pending" | "failed" = "completed";
      let jobError: string | undefined;
      let seen = 0,
        added = 0;
      try {
        sourceDeadline();
        await checkpoint(`Source: ${feed.name}`);
        sourceSchema.parse(feed);
        const hostname = approvedSourceUrl(feed.url).hostname;
        const state = providerMap.get(hostname);
        if (isProviderCooling(state)) {
          deferFeed(feed, state!.last_error ?? "Udbyderen holder pause", state!.blocked_until!);
          return;
        }
        const cutoff = Date.parse(job.created_at) - 30 * 864e5;
        const pending: {
          headline: string;
          summary: string | null;
          canonical_url: string;
          publisher: string;
          published_at: string;
          published_at_estimated: boolean;
          headline_norm: string;
        }[] = [];
        const flush = async () => {
          if (!pending.length) return;
          sourceDeadline();
          const batch = pending.splice(0);
          const existing = await checked(
            admin
              .from("items")
              .select("*")
              .in(
                "canonical_url",
                batch.map((i) => i.canonical_url),
              ),
          );
          const headlineCopies =
            feed.connector === "rss"
              ? await checked(
                  admin
                    .from("items")
                    .select("*")
                    .in(
                      "headline_norm",
                      batch.map((i) => i.headline_norm),
                    )
                    .eq("is_seed", false)
                    .gte("published_at", new Date(Date.now() - 48 * 36e5).toISOString())
                    .order("id"),
                )
              : [];
          const refresh = feed.connector === "pubmed" || feed.connector === "clinicaltrials";
          const records = batch.map((incoming) => {
            const previous =
              existing?.find((i) => i.canonical_url === incoming.canonical_url) ??
              headlineCopies?.find((i) => i.headline_norm === incoming.headline_norm);
            const item = previous && !refresh ? previous : incoming;
            const source = previous ? previous.feed_id : feed.id;
            const current =
              previous?.match_revision === snapshot.revision &&
              previous.match_algorithm === MATCH_ALGORITHM &&
              previous.headline === item.headline &&
              previous.summary === item.summary &&
              previous.published_at === item.published_at;
            return {
              item: incoming,
              existing_id: previous?.id ?? null,
              feed_id: feed.id,
              refresh,
              input: [item.headline, item.summary, item.published_at, source],
              matches: current
                ? []
                : matchesFor(
                    item,
                    source ? (weightMap.get(source) ?? Number(feed.source_weight)) : 0.5,
                    source,
                  ),
            };
          });
          const result = (await checked(
            admin.rpc("store_job_batch", {
              p_job_id: job.id,
              p_token: job.lease_token,
              p_records: records,
              p_revision: snapshot.revision,
              p_algorithm: MATCH_ALGORITHM,
            }),
          )) as { created: number };
          if (!result) throw new Error("Databasen bekræftede ikke lagring af historierne.");
          added += result.created;
          newCount += result.created;
        };
        const store = async (parsed: ParsedItem) => {
          sourceDeadline();
          seen++;
          const validDate =
            parsed.publishedAt &&
            Number.isFinite(parsed.publishedAt.getTime()) &&
            parsed.publishedAt.getTime() <= Date.now() + 864e5;
          if (validDate && parsed.publishedAt!.getTime() < cutoff) return;
          pending.push({
            headline:
              parsed.publisher && parsed.headline.endsWith(` - ${parsed.publisher}`)
                ? parsed.headline.slice(0, -(parsed.publisher.length + 3))
                : parsed.headline,
            summary: parsed.summary || null,
            canonical_url: publicSourceUrl(canonicalizeUrl(parsed.link)).href,
            publisher:
              (feed.kind === "google_news" || feed.connector === "currents") && parsed.publisher
                ? parsed.publisher
                : feed.publisher,
            published_at: (validDate ? parsed.publishedAt! : new Date()).toISOString(),
            published_at_estimated: !validDate,
            headline_norm: normalizeHeadline(parsed.headline, parsed.publisher),
          });
          if (pending.length >= 50) await flush();
        };

        let etag: string | null = null,
          modified: string | null = null;
        if (feed.connector === "announcements") {
          await collectAnnouncements(feed.url, store, sourceDeadline);
        } else if (feed.connector === "currents") {
          const key = process.env["CURRENTS_API_KEY"];
          if (!key) throw new Error("Currents API-nøglen er ikke konfigureret.");
          let articles: ParsedItem[];
          try {
            articles = await fetchCurrentsSearch(
              feed.url,
              key,
              createCurrentsRequest(admin, "ingest"),
            );
          } catch (error) {
            if (!(error instanceof CurrentsQuotaError)) throw error;
            const tomorrow = new Date();
            tomorrow.setUTCHours(24, 0, 0, 0);
            deferFeed(feed, error.message, tomorrow.toISOString());
            return;
          }
          for (const article of articles) await store(article);
          if (articles.length >= 20)
            log.push({
              feed: feed.name,
              status: "limited",
              error:
                "Piloten henter kun første side (højst 20 artikler); flere resultater kan findes.",
            });
        } else if (feed.connector === "clinicaltrials") {
          const url = new URL(feed.url);
          url.searchParams.set("format", "json");
          url.searchParams.set("sort", "LastUpdatePostDate:desc");
          url.searchParams.set("pageSize", "100");
          if (job.cursor.pageToken) url.searchParams.set("pageToken", job.cursor.pageToken);
          let pages = job.cursor.pages ?? 0;
          for (;;) {
            sourceDeadline();
            const response = await fetchSource(url.href, {
              "User-Agent": UA,
              Accept: "application/json",
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const page = parseTrials(JSON.parse(await readBody(response)));
            for (const item of page.items) await store(item);
            if (
              !page.nextPageToken ||
              page.items.some((item) => item.publishedAt && item.publishedAt.getTime() < cutoff)
            )
              break;
            if (++pages >= 10)
              throw new Error(
                "API-søgningen overstiger 1.000 forsøg. Brug en smallere sponsorsøgning.",
              );
            await flush();
            await saveCursor({ pageToken: page.nextPageToken, pages });
            url.searchParams.set("pageToken", page.nextPageToken);
          }
        } else if (feed.connector === "pubmed") {
          const search = new URL(feed.url);
          for (const [key, value] of Object.entries({
            db: "pubmed",
            retmode: "json",
            retmax: "100",
            datetype: "edat",
            mindate: new Date(cutoff).toISOString().slice(0, 10).replaceAll("-", "/"),
            maxdate: job.created_at.slice(0, 10).replaceAll("-", "/"),
            sort: "pub_date",
          }))
            search.searchParams.set(key, value);
          search.searchParams.delete("api_key");
          for (let offset = job.cursor.offset ?? 0; ; offset += 100) {
            search.searchParams.set("retstart", String(offset));
            const result = pubmedSearchSchema.parse(
              JSON.parse(await fetchNcbi(search.href, "application/json")),
            ).esearchresult;
            if (Number(result.count) > 1000)
              throw new Error(
                "PubMed-søgningen overstiger 1.000 artikler. Brug en smallere søgning.",
              );
            if (!result.idlist.length) break;
            const candidates = result.idlist.map((id) => `https://pubmed.ncbi.nlm.nih.gov/${id}/`);
            const cached = await checked(
              admin.from("items").select("id,canonical_url").in("canonical_url", candidates),
            );
            const known = new Set((cached ?? []).map((item) => item.canonical_url));
            const missing = result.idlist.filter(
              (id) => !known.has(`https://pubmed.ncbi.nlm.nih.gov/${id}/`),
            );
            seen += result.idlist.length - missing.length;
            if (cached?.length)
              await checked(
                admin.from("item_sources").upsert(
                  cached.map((item) => ({ item_id: item.id, feed_id: feed.id })),
                  { onConflict: "item_id,feed_id", ignoreDuplicates: true },
                ),
              );
            if (!missing.length) {
              if (offset + result.idlist.length >= Number(result.count)) break;
              await saveCursor({ offset: offset + 100 });
              continue;
            }
            const details = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
            details.search = new URLSearchParams({
              db: "pubmed",
              retmode: "xml",
              id: missing.join(","),
            }).toString();
            let articles: ParsedItem[] | undefined;
            for (let attempt = 0; attempt < 2; attempt++) {
              await checkpoint(`PubMed EFetch: ${missing.length} records, attempt ${attempt + 1}`);
              const body = await fetchNcbi(details.href, "application/xml");
              try {
                articles = parsePubmed(body);
                break;
              } catch (error) {
                // A successful HTTP status can still contain a truncated or invalid payload.
                // Retry once through the same paced transport; never checkpoint body or URL/key.
                const message = error instanceof Error ? error.message : "Invalid PubMed payload";
                log.push({
                  feed: feed.name,
                  status: "payload-warning",
                  error: `${message} (${body.length} characters; attempt ${attempt + 1})`,
                });
                if (attempt === 1) throw error;
                await checkpoint("Retrying invalid PubMed EFetch payload");
                await new Promise((resolve) => setTimeout(resolve, 2_000));
              }
            }
            if (!articles) throw new Error("PubMed returnerede ingen gyldig artikelsamling.");
            if (articles.length !== missing.length)
              throw new Error("PubMed returnerede ikke alle forespurgte artikler.");
            for (const article of articles) await store(article);
            await flush();
            await saveCursor({ offset: offset + 100 });
            if (offset + result.idlist.length >= Number(result.count)) break;
          }
        } else {
          const headers: Record<string, string> = {
            "User-Agent": UA,
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          };
          if (feed.etag) headers["If-None-Match"] = feed.etag;
          if (feed.last_modified) headers["If-Modified-Since"] = feed.last_modified;
          const response = await (new URL(feed.url).hostname === "news.google.com"
            ? fetchGoogle(feed.url, headers)
            : fetchSource(feed.url, headers));
          if (response.status === 304) {
            await checked(
              admin.rpc("commit_source_success", {
                p_job_id: job.id,
                p_token: job.lease_token,
                p_patch: {
                  last_items_new: 0,
                  next_poll_at: nextPollAt(feed.poll_interval_minutes ?? 15),
                },
              }),
            );
            await providerSuccess(hostname);
            ok++;
            log.push({ feed: feed.name, status: "unchanged", items: 0 });
            return;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await readBody(response);
          if (hostname === "news.google.com" && isAutomatedRequestBlock(body))
            throw new SourceHttpError(hostname, 200, true, null);
          for (const item of parseFeed(body)) await store(item);
          etag = response.headers.get("etag");
          modified = response.headers.get("last-modified");
        }
        await flush();
        // Advance cache validators only after every story and match has committed.
        await checked(
          admin.rpc("commit_source_success", {
            p_job_id: job.id,
            p_token: job.lease_token,
            p_patch: {
              etag,
              last_modified: modified,
              last_items_seen: seen,
              last_items_new: added,
              next_poll_at: nextPollAt(feed.poll_interval_minutes ?? 15),
            },
          }),
        );
        await providerSuccess(hostname);
        ok++;
        log.push({ feed: feed.name, status: "ok", seen, items: added });
      } catch (error) {
        if (error instanceof SourceYield) {
          jobStatus = feed.connector === "currents" ? "failed" : "pending";
          jobError = error.message;
          deferFeed(feed, error.message, nextPollAt(15));
          return;
        }
        jobStatus = "failed";
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        jobError = message;
        await saveCursor(job.cursor);
        const coolUntil =
          error instanceof SourceHttpError &&
          ([401, 403, 429, 502, 503, 504].includes(error.status) || error.blocked)
            ? await providerFailure(error)
            : null;
        log.push({ feed: feed.name, status: "error", seen, items: added, error: message });
        await checked(
          admin
            .from("feeds")
            .update({
              last_polled_at: new Date().toISOString(),
              last_error: message.slice(0, 500),
              consecutive_failures: feed.consecutive_failures + 1,
              next_poll_at: coolUntil ?? nextPollAt(feed.poll_interval_minutes ?? 15),
              last_items_seen: seen,
              last_items_new: added,
            })
            .eq("id", feed.id),
        );
      } finally {
        await requireJobLease(
          admin.rpc("finish_source_job", {
            p_id: job.id,
            p_token: job.lease_token,
            p_status: jobStatus,
            ...(jobError ? { p_error: jobError } : {}),
          }),
        );
      }
    };

    if (mode === "ingest") {
      let query = admin
        .from("feeds")
        .select("*")
        .eq("active", true)
        .order("last_polled_at", { nullsFirst: true })
        .order("id");
      if (opts.feedIds?.length) query = query.in("id", opts.feedIds);
      const feeds = (await checked(query)) ?? [];
      const ready = feeds.filter(
        (feed) =>
          (feed.connector !== "currents" ||
            (opts.trigger !== "schedule" && opts.feedIds?.length)) &&
          (opts.feedIds?.length ||
            !feed.next_poll_at ||
            Date.parse(feed.next_poll_at) <= Date.now()),
      );
      const isGoogle = (feed: Feed) => {
        try {
          return new URL(feed.url).hostname === "news.google.com";
        } catch {
          return false;
        }
      };
      const primary = ready.filter((feed) => !isGoogle(feed));
      const google = ready.filter(isGoogle);
      // One dispatcher owns the global lease: host pacing remains serialized across jobs.
      // Do not start more work near the budget; untouched due sources remain eligible.
      for (const feed of [...primary, ...google.slice(0, GOOGLE_FEEDS_PER_RUN)]) {
        if (Date.now() - started > 75_000) {
          deferFeed(feed, "Afventer næste tidsplankald.", nextPollAt(15));
          continue;
        }
        await processFeed(feed);
        await checkpoint("Source job completed");
      }
      for (const feed of google.slice(GOOGLE_FEEDS_PER_RUN)) {
        const state = providerMap.get("news.google.com");
        deferFeed(
          feed,
          isProviderCooling(state)
            ? (state!.last_error ?? "Google News holder pause")
            : "Google News fordeles over flere intervaller",
          isProviderCooling(state) ? state!.blocked_until! : nextPollAt(15),
        );
      }
    }
    // Bounded, restartable work: unchanged archives require only one empty lookup.
    // No cursor is lost on interruption; successful rows leave the pending set atomically.
    for (let page = 0; page < 4; page++) {
      if (Date.now() - started > 100_000) break;
      const items = (await checked(
        admin.rpc("pending_match_items", {
          p_revision: snapshot.revision,
          p_algorithm: MATCH_ALGORITHM,
          p_limit: 100,
        }),
      )) as unknown as {
        id: string;
        headline: string;
        summary: string | null;
        published_at: string;
        feed_id: string | null;
      }[];
      if (!items?.length) break;
      const records = items.map((item) => ({
        id: item.id,
        input: [item.headline, item.summary, item.published_at, item.feed_id],
        matches: matchesFor(
          item,
          item.feed_id ? (weightMap.get(item.feed_id) ?? 0.5) : 0.5,
          item.feed_id,
        ),
      }));
      rematched +=
        (await checked(
          admin.rpc("replace_matches_batch", {
            p_records: records,
            p_revision: snapshot.revision,
            p_algorithm: MATCH_ALGORITHM,
          }),
        )) ?? 0;
      await checkpoint(`Pending archive matches: ${rematched} stories completed`);
    }
    log.push({ feed: "archive", status: "rematched", items: rematched });
    await checked(
      admin
        .from("ingest_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: failed ? "partial" : "completed",
          feeds_ok: ok,
          feeds_failed: failed,
          feeds_deferred: deferred,
          items_new: newCount,
          log: log as Json,
        })
        .eq("id", runId)
        .eq("status", "running"),
    );
    return { ok, failed, newCount, rematched, deferred };
  } catch (error) {
    log.push({
      feed: "collection",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    await checked(
      admin
        .from("ingest_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          feeds_ok: ok,
          feeds_failed: failed,
          feeds_deferred: deferred,
          items_new: newCount,
          log: log as Json,
        })
        .eq("id", runId)
        .eq("status", "running"),
    );
    throw error;
  }
}
