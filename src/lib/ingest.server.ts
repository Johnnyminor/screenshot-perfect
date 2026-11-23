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
import { publicSourceUrl, sourceSchema } from "./source-config";

type Admin = SupabaseClient<Database>;
type Feed = Database["public"]["Tables"]["feeds"]["Row"];
const UA = "LexNyhedsmonitor/1.0 (+https://lex.dk)";
const BATCH = 4;
const MAX_BYTES = 5_000_000;
const MAX_RUNTIME = 10 * 60_000; // Below the 20-minute database lease.

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

async function fetchSource(
  raw: string,
  headers: Record<string, string>,
  redirects = 0,
): Promise<Response> {
  const url = publicSourceUrl(raw);
  const response = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects >= 4) throw new Error("For mange eller ugyldige omdirigeringer.");
    return fetchSource(new URL(location, url).href, headers, redirects + 1);
  }
  return response;
}

async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Kilden returnerede intet indhold.");
  const decoder = new TextDecoder();
  let size = 0,
    body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Kilden overskrider grænsen på 5 MB pr. svar.");
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel();
  }
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
      throw new Error("Kørslen overskred 10 minutter. Begræns kildeudvalget.");
  };
  const mode = opts.mode ?? "ingest";
  const runId = await checked(
    admin.rpc("begin_collection", { p_mode: mode, p_trigger: opts.trigger ?? "manual" }),
  );
  if (!runId) throw new Error("Kørslen kunne ikke oprettes.");
  const log: { feed: string; status: string; seen?: number; items?: number; error?: string }[] = [];
  let ok = 0,
    failed = 0,
    newCount = 0,
    rematched = 0;
  try {
    const [companies, topics, weights] = await Promise.all([
      checked(admin.from("companies").select("*").eq("active", true)),
      checked(admin.from("topics").select("*").eq("active", true)),
      checked(admin.from("feeds").select("id,source_weight")),
    ]);
    const weightMap = new Map((weights ?? []).map((feed) => [feed.id, Number(feed.source_weight)]));
    const matchesFor = (
      item: { headline: string; summary: string | null; published_at: string },
      weight: number,
    ) => buildMatches(companies ?? [], topics ?? [], item, weight);

    // Serialize NCBI requests across sources, below three requests per second.
    let ncbiQueue = Promise.resolve(),
      lastNcbiRequest = 0;
    const fetchNcbi = (url: string, accept: string): Promise<string> => {
      const result = ncbiQueue.then(async () => {
        const wait = Math.max(0, 400 - (Date.now() - lastNcbiRequest));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        deadline();
        lastNcbiRequest = Date.now();
        const response = await fetchSource(url, { "User-Agent": UA, Accept: accept });
        if (!response.ok) throw new Error(`NCBI HTTP ${response.status}`);
        return readBody(response);
      });
      ncbiQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const processFeed = async (feed: Feed) => {
      let seen = 0,
        added = 0;
      try {
        deadline();
        sourceSchema.parse(feed);
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
              feed.kind === "google_news" && parsed.publisher ? parsed.publisher : feed.publisher,
            published_at: published.toISOString(),
            published_at_estimated: !validDate,
            headline_norm: norm,
          };
          const refresh = feed.connector !== "rss";
          const item = existing && !refresh ? existing : incoming;
          const stored = await checked(
            admin.rpc("store_collected_item", {
              p_item: incoming,
              p_existing_id: existing?.id ?? null,
              p_feed_id: feed.id,
              p_refresh: refresh,
              p_matches: matchesFor(
                item,
                existing?.feed_id
                  ? (weightMap.get(existing.feed_id) ?? 0.5)
                  : Number(feed.source_weight),
              ),
            }),
          );
          if (!stored) throw new Error("Databasen bekræftede ikke lagring af historien.");
          if (stored.created) {
            added++;
            newCount++;
          }
        };

        let etag: string | null = null,
          modified: string | null = null;
        if (feed.connector === "clinicaltrials") {
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
            const details = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
            details.search = new URLSearchParams({
              db: "pubmed",
              retmode: "xml",
              id: result.idlist.join(","),
            }).toString();
            const articles = parsePubmed(await fetchNcbi(details.href, "application/xml"));
            if (articles.length !== result.idlist.length)
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
          const response = await fetchSource(feed.url, headers);
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
                })
                .eq("id", feed.id),
            );
            ok++;
            log.push({ feed: feed.name, status: "unchanged", items: 0 });
            return;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          for (const item of parseFeed(await readBody(response))) await store(item);
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
            })
            .eq("id", feed.id),
        );
        ok++;
        log.push({ feed: feed.name, status: "ok", seen, items: added });
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        log.push({ feed: feed.name, status: "error", seen, items: added, error: message });
        await checked(
          admin
            .from("feeds")
            .update({
              last_polled_at: new Date().toISOString(),
              last_error: message.slice(0, 500),
              consecutive_failures: feed.consecutive_failures + 1,
              last_items_seen: seen,
              last_items_new: added,
            })
            .eq("id", feed.id),
        );
      }
    };

    if (mode === "ingest") {
      let query = admin.from("feeds").select("*").eq("active", true).order("id");
      if (opts.feedIds?.length) query = query.in("id", opts.feedIds);
      const feeds = await checked(query);
      for (let i = 0; i < (feeds ?? []).length; i += BATCH) {
        const results = await Promise.allSettled(
          (feeds ?? []).slice(i, i + BATCH).map(processFeed),
        );
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
      }
    }
    // Re-evaluate archived stories even when feeds returned 304, with keyset pagination.
    let after: string | undefined;
    for (;;) {
      deadline();
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
            p_matches: matchesFor(item, item.feed_id ? (weightMap.get(item.feed_id) ?? 0.5) : 0.5),
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
          items_new: newCount,
          log: log as Json,
        })
        .eq("id", runId),
    );
    return { ok, failed, newCount, rematched };
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
          items_new: newCount,
          log: log as Json,
        })
        .eq("id", runId),
    );
    throw error;
  }
}
