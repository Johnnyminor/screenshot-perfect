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
const BATCH = 4;
const MAX_RUNTIME = 5 * 60_000; // Below the 20-minute database lease.

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
      throw new Error("Kørslen overskred 5 minutter. Begræns kildeudvalget.");
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
          .eq("id", runId),
      );
    });
    checkpointQueue = pending.catch(() => undefined);
    return pending;
  };
  try {
    await checkpoint("Loading configuration");
    const [companies, topics, weights, providers] = await Promise.all([
      checked(admin.from("companies").select("*").eq("active", true)),
      checked(admin.from("topics").select("*").eq("active", true)),
      checked(admin.from("feeds").select("id,source_weight,company_id,kind,connector")),
      checked(admin.from("provider_health").select("*")),
    ]);
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
      let seen = 0,
        added = 0;
      try {
        deadline();
        await checkpoint(`Source: ${feed.name}`);
        sourceSchema.parse(feed);
        const hostname = approvedSourceUrl(feed.url).hostname;
        const state = providerMap.get(hostname);
        if (isProviderCooling(state)) {
          deferFeed(feed, state!.last_error ?? "Udbyderen holder pause", state!.blocked_until!);
          return;
        }
        const cutoff = Date.now() - 30 * 864e5;
        const store = async (parsed: ParsedItem) => {
          deadline();
          seen++;
          const validDate =
            parsed.publishedAt &&
            Number.isFinite(parsed.publishedAt.getTime()) &&
            parsed.publishedAt.getTime() <= Date.now() + 864e5;
          if (validDate && parsed.publishedAt!.getTime() < cutoff) return;
          const published = validDate ? parsed.publishedAt! : new Date();
          const url = publicSourceUrl(canonicalizeUrl(parsed.link)).href;
          const norm = normalizeHeadline(parsed.headline, parsed.publisher);
          let existing = await checked(
            admin.from("items").select("*").eq("canonical_url", url).maybeSingle(),
          );
          if (!existing && feed.connector === "rss") {
            const since = new Date(Date.now() - 48 * 36e5).toISOString();
            existing = await checked(
              admin
                .from("items")
                .select("*")
                .eq("headline_norm", norm)
                .eq("is_seed", false)
                .gte("published_at", since)
                .order("id")
                .limit(1)
                .maybeSingle(),
            );
          }
          const incoming = {
            headline:
              parsed.publisher && parsed.headline.endsWith(` - ${parsed.publisher}`)
                ? parsed.headline.slice(0, -(parsed.publisher.length + 3))
                : parsed.headline,
            summary: parsed.summary || null,
            canonical_url: url,
            publisher:
              (feed.kind === "google_news" || feed.connector === "currents") && parsed.publisher
                ? parsed.publisher
                : feed.publisher,
            published_at: published.toISOString(),
            published_at_estimated: !validDate,
            headline_norm: norm,
          };
          const refresh = feed.connector === "pubmed" || feed.connector === "clinicaltrials";
          const item = existing && !refresh ? existing : incoming;
          const stored = await checked(
            admin.rpc("store_collected_item", {
              p_item: incoming,
              // Generated types omit SQL nullability; the function accepts NULL.
              p_existing_id: (existing?.id ?? null) as string,
              p_feed_id: feed.id,
              p_refresh: refresh,
              p_matches: matchesFor(
                item,
                existing?.feed_id
                  ? (weightMap.get(existing.feed_id) ?? 0.5)
                  : Number(feed.source_weight),
                existing?.feed_id ?? feed.id,
              ),
            }),
          );
          if (!stored) throw new Error("Databasen bekræftede ikke lagring af historien.");
          if ((stored as { created?: boolean }).created) {
            added++;
            newCount++;
          }
        };

        let etag: string | null = null,
          modified: string | null = null;
        if (feed.connector === "announcements") {
          await collectAnnouncements(feed.url, store, deadline);
        } else if (feed.connector === "currents") {
          const key = process.env["CURRENTS_API_KEY"];
          if (!key) throw new Error("Currents API-nøglen er ikke konfigureret.");
          if (!(await checked(admin.rpc("claim_currents_request")))) {
            const tomorrow = new Date();
            tomorrow.setUTCHours(24, 0, 0, 0);
            deferFeed(
              feed,
              "Currents-pilotens grænse på 40 forespørgsler pr. UTC-døgn er nået.",
              tomorrow.toISOString(),
            );
            return;
          }
          const articles = await fetchCurrentsSearch(feed.url, key);
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
          let pages = 0;
          for (;;) {
            deadline();
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
            url.searchParams.set("pageToken", page.nextPageToken);
          }
        } else if (feed.connector === "pubmed") {
          const search = new URL(feed.url);
          for (const [key, value] of Object.entries({
            db: "pubmed",
            retmode: "json",
            retmax: "100",
            datetype: "edat",
            reldate: "30",
            sort: "pub_date",
          }))
            search.searchParams.set(key, value);
          search.searchParams.delete("api_key");
          for (let offset = 0; ; offset += 100) {
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
              admin
                .from("feeds")
                .update({
                  last_polled_at: new Date().toISOString(),
                  last_success_at: new Date().toISOString(),
                  last_error: null,
                  consecutive_failures: 0,
                  last_items_new: 0,
                  next_poll_at: nextPollAt(feed.poll_interval_minutes ?? 15),
                })
                .eq("id", feed.id),
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
        // Advance cache validators only after every story and match has committed.
        await checked(
          admin
            .from("feeds")
            .update({
              last_polled_at: new Date().toISOString(),
              last_success_at: new Date().toISOString(),
              last_error: null,
              consecutive_failures: 0,
              etag,
              last_modified: modified,
              last_items_seen: seen,
              last_items_new: added,
              next_poll_at: nextPollAt(feed.poll_interval_minutes ?? 15),
            })
            .eq("id", feed.id),
        );
        await providerSuccess(hostname);
        ok++;
        log.push({ feed: feed.name, status: "ok", seen, items: added });
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
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
      const primary = ready.filter((feed) => !isGoogle(feed) && feed.connector !== "currents");
      for (let i = 0; i < primary.length; i += BATCH) {
        const results = await Promise.allSettled(primary.slice(i, i + BATCH).map(processFeed));
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
        await checkpoint("Primary source batch completed");
      }
      for (const feed of ready.filter((feed) => feed.connector === "currents"))
        await processFeed(feed);
      const google = ready.filter(isGoogle);
      for (const feed of google.slice(0, GOOGLE_FEEDS_PER_RUN)) {
        await processFeed(feed);
        await checkpoint("Google source completed");
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
    // Re-evaluate archived stories even when feeds returned 304, with keyset pagination.
    let after: string | undefined;
    for (;;) {
      deadline();
      await checkpoint(`Archive rematch: ${rematched} stories completed`);
      let query = admin
        .from("items")
        .select("id,headline,summary,published_at,feed_id")
        .eq("is_seed", false)
        .order("id")
        .limit(200);
      if (after) query = query.gt("id", after);
      const items = await checked(query);
      for (const item of items ?? []) {
        deadline();
        await checked(
          admin.rpc("replace_item_matches", {
            p_item_id: item.id,
            p_matches: matchesFor(
              item,
              item.feed_id ? (weightMap.get(item.feed_id) ?? 0.5) : 0.5,
              item.feed_id,
            ),
          }),
        );
        rematched++;
      }
      if (!items?.length || items.length < 200) break;
      after = items.at(-1)!.id;
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
        .eq("id", runId),
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
        .eq("id", runId),
    );
    throw error;
  }
}
