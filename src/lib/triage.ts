// Pure triage helpers shared by ingestion and UI. No I/O here so it stays testable.

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|cmpid$|ocid$)/i;

/** Normalise a URL so the same story from several feeds dedups to one row. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if (u.protocol === "http:") u.protocol = "https:";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return raw.trim();
  }
}

/** Google News titles end with " - Publisher"; strip it for comparison. */
export function normalizeHeadline(headline: string, publisher?: string): string {
  let h = headline.trim();
  if (publisher && h.endsWith(` - ${publisher}`)) h = h.slice(0, -(publisher.length + 3));
  return h
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtml(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsTerm(text: string, term: string, caseSensitive = false): boolean {
  if (!term.trim()) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, caseSensitive ? "u" : "iu");
  return re.test(text);
}

export type Watchable = {
  id: string;
  name: string;
  aliases: string[];
  case_sensitive_aliases?: string[];
  exclude_terms?: string[];
};

export type MatchResult = { id: string; terms: string[]; strength: number };

/**
 * Match strength: name in headline 1.0, alias in headline 0.8,
 * anything only in summary 0.5. Exclude terms veto the match.
 */
export function matchEntity(entity: Watchable, headline: string, summary: string): MatchResult | null {
  const both = `${headline} ${summary}`;
  for (const ex of entity.exclude_terms ?? []) {
    if (containsTerm(both, ex)) return null;
  }
  const terms: string[] = [];
  let strength = 0;
  const check = (term: string, cs: boolean, headlineScore: number) => {
    if (containsTerm(headline, term, cs)) {
      terms.push(term);
      strength = Math.max(strength, headlineScore);
    } else if (containsTerm(summary, term, cs)) {
      terms.push(term);
      strength = Math.max(strength, 0.5);
    }
  };
  check(entity.name, false, 1.0);
  for (const a of entity.aliases) check(a, false, 0.8);
  for (const a of entity.case_sensitive_aliases ?? []) check(a, true, 0.8);
  if (!terms.length) return null;
  return { id: entity.id, terms: [...new Set(terms)], strength };
}

/** v1 relevance: source weight 50%, match strength 40%, recency bonus up to 10%. */
export function relevanceScore(sourceWeight: number, strength: number, publishedAt: Date, now = new Date()): number {
  const ageH = (now.getTime() - publishedAt.getTime()) / 36e5;
  const recency = ageH <= 24 ? 0.1 : ageH <= 72 ? 0.05 : 0;
  return Math.round((sourceWeight * 0.5 + strength * 0.4 + recency) * 100) / 100;
}

export function buildCitation(i: { publisher: string; headline: string; canonical_url: string; published_at: string }): string {
  const d = new Date(i.published_at);
  const date = d.toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" });
  return `${i.publisher}: "${i.headline}", ${date}. ${i.canonical_url}`;
}

export function googleNewsUrl(companyName: string): string {
  return `https://news.google.com/rss/search?q=%22${companyName.replace(/ /g, "+")}%22&hl=da&gl=DK&ceid=DK:da`;
}
