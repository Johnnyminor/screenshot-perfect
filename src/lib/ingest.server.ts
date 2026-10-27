// Server-only RSS ingestion: fetch feeds politely, parse, dedup, match, score, store.
import { XMLParser } from "fast-xml-parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { canonicalizeUrl, matchEntity, normalizeHeadline, relevanceScore, stripHtml } from "./triage";

type Admin = SupabaseClient<Database>;
type Feed = Database["public"]["Tables"]["feeds"]["Row"];

const UA = "LexNyhedsmonitor/1.0 (intern redaktionsværktøj; +https://lex.dk)";
const MAX_AGE_DAYS = 30;
const BATCH = 6;

type ParsedItem = { headline: string; link: string; publishedAt: Date | null; summary: string; publisher?: string };

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}
const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function parseFeed(xml: string): ParsedItem[] {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = p.parse(xml);
  const out: ParsedItem[] = [];
  const rssItems = arr(doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item);
  for (const it of rssItems) {
    const date = text(it.pubDate) || text(it["dc:date"]);
    out.push({
      headline: stripHtml(text(it.title)),
      link: text(it.link) || text(it.guid),
      publishedAt: date ? new Date(date) : null,
      summary: stripHtml(text(it.description)).slice(0, 1000),
      publisher: text(it.source) || undefined,
    });
  }
  for (const e of arr(doc?.feed?.entry)) {
    const links = arr(e.link);
    const alt = links.find((l: Record<string, string>) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    const date = text(e.published) || text(e.updated);
    out.push({
      headline: stripHtml(text(e.title)),
      link: typeof alt === "string" ? alt : alt?.["@_href"] ?? "",
      publishedAt: date ? new Date(date) : null,
      summary: stripHtml(text(e.summary) || text(e.content)).slice(0, 1000),
    });
  }
  return out.filter((i) => i.headline && i.link);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runIngest(admin: Admin, opts: { feedIds?: string[] } = {}) {
  const { data: run } = await admin.from("ingest_runs").insert({}).select("id").single();
  let q = admin.from("feeds").select("*").eq("active", true);
  if (opts.feedIds?.length) q = q.in("id", opts.feedIds);
  const [{ data: feeds }, { data: companies }, { data: topics }] = await Promise.all([
    q,
    admin.from("companies").select("id,name,aliases,case_sensitive_aliases,exclude_terms").eq("active", true),
    admin.from("topics").select("id,name,keywords").eq("active", true),
  ]);
  const log: { feed: string; status: string; items?: number; error?: string }[] = [];
  let ok = 0, failed = 0, newCount = 0;

  const processFeed = async (feed: Feed) => {
    await sleep(Math.random() * 2000); // jitter
    const now = new Date();
    try {
      const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" };
      if (feed.etag) headers["If-None-Match"] = feed.etag;
      if (feed.last_modified) headers["If-Modified-Since"] = feed.last_modified;
      const res = await fetch(feed.url, { headers, signal: AbortSignal.timeout(10000), redirect: "follow" });
      if (res.status === 304) {
        await admin.from("feeds").update({ last_polled_at: now.toISOString(), last_success_at: now.toISOString(), last_error: null, consecutive_failures: 0 }).eq("id", feed.id);
        ok++; log.push({ feed: feed.name, status: "uændret" });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseFeed(await res.text());
      const cutoff = now.getTime() - MAX_AGE_DAYS * 864e5;
      let added = 0;
      for (const p of parsed) {
        const published = p.publishedAt && !isNaN(p.publishedAt.getTime()) ? p.publishedAt : null;
        if (published && published.getTime() < cutoff) continue;
        const publisher = feed.kind === "google_news" && p.publisher ? p.publisher : feed.publisher;
        const url = canonicalizeUrl(p.link);
        const norm = normalizeHeadline(p.headline, p.publisher);
        let existingId: string | null = null;
        const { data: byUrl } = await admin.from("items").select("id").eq("canonical_url", url).maybeSingle();
        existingId = byUrl?.id ?? null;
        if (!existingId) {
          const since = new Date(now.getTime() - 48 * 36e5).toISOString();
          const { data: byHead } = await admin.from("items").select("id").eq("headline_norm", norm).gte("published_at", since).limit(1).maybeSingle();
          existingId = byHead?.id ?? null;
        }
        if (existingId) {
          await admin.from("item_sources").upsert({ item_id: existingId, feed_id: feed.id }, { onConflict: "item_id,feed_id", ignoreDuplicates: true });
          continue;
        }
        let headline = p.headline;
        if (p.publisher && headline.endsWith(` - ${p.publisher}`)) headline = headline.slice(0, -(p.publisher.length + 3));
        const { data: ins, error } = await admin.from("items").insert({
          headline, summary: p.summary || null, canonical_url: url, publisher, feed_id: feed.id,
          published_at: (published ?? now).toISOString(), published_at_estimated: !published, headline_norm: norm,
        }).select("id").single();
        if (error || !ins) continue; // race with another feed: unique violation
        added++;
        await admin.from("item_sources").insert({ item_id: ins.id, feed_id: feed.id });
        const pub = published ?? now;
        const matches: Database["public"]["Tables"]["item_matches"]["Insert"][] = [];
        for (const c of companies ?? []) {
          const m = matchEntity(c, headline, p.summary);
          if (m) matches.push({ item_id: ins.id, company_id: c.id, matched_terms: m.terms, relevance_score: relevanceScore(Number(feed.source_weight), m.strength, pub, now) });
        }
        for (const t of topics ?? []) {
          let best: ReturnType<typeof matchEntity> = null;
          for (const k of t.keywords) {
            const m = matchEntity({ id: t.id, name: k, aliases: [] }, headline, p.summary);
            if (m && (!best || m.strength > best.strength)) best = { ...m, terms: [...(best?.terms ?? []), ...m.terms] };
          }
          if (best) matches.push({ item_id: ins.id, topic_id: t.id, matched_terms: best.terms, relevance_score: relevanceScore(Number(feed.source_weight), best.strength, pub, now) });
        }
        if (matches.length) await admin.from("item_matches").insert(matches);
      }
      newCount += added; ok++;
      await admin.from("feeds").update({
        last_polled_at: now.toISOString(), last_success_at: now.toISOString(), last_error: null, consecutive_failures: 0,
        etag: res.headers.get("etag"), last_modified: res.headers.get("last-modified"),
      }).eq("id", feed.id);
      log.push({ feed: feed.name, status: "ok", items: added });
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      await admin.from("feeds").update({ last_polled_at: now.toISOString(), last_error: msg.slice(0, 500), consecutive_failures: feed.consecutive_failures + 1 }).eq("id", feed.id);
      log.push({ feed: feed.name, status: "fejl", error: msg });
    }
  };

  const list = feeds ?? [];
  for (let i = 0; i < list.length; i += BATCH) {
    await Promise.all(list.slice(i, i + BATCH).map(processFeed));
  }
  if (run) {
    await admin.from("ingest_runs").update({ finished_at: new Date().toISOString(), feeds_ok: ok, feeds_failed: failed, items_new: newCount, log }).eq("id", run.id);
  }
  return { ok, failed, newCount };
}
