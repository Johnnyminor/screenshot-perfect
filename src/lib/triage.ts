// Pure triage helpers shared by ingestion and UI. No I/O here so it stays testable.

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|cmpid$|ocid$)/i;

/** Normalise a URL so the same story from several feeds dedups to one row. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    // Ambu publishes distinct releases as hash-routed items on one official page.
    // Preserve only that documented item identifier; other fragments remain tracking noise.
    if (!(
      u.hostname === "www.ambu.com" &&
      u.pathname === "/corporate-info/investors/news-from-ambu" &&
      /^#\/ambu-news-item=\d+\/$/.test(u.hash)
    ))
      u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if (u.protocol === "http:") u.protocol = "https:";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    if (u.pathname.length > 1 && u.pathname.endsWith("/"))
      u.pathname = u.pathname.replace(/\/+$/, "");
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
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`,
    caseSensitive ? "u" : "iu",
  );
  return re.test(text);
}

export type Watchable = {
  id: string;
  name: string;
  aliases: string[];
  case_sensitive_aliases?: string[];
  exclude_terms?: string[];
  ambiguous_terms?: string[];
  context_terms?: string[];
  excluded_name_phrases?: string[];
};

export type MatchResult = { id: string; terms: string[]; strength: number };

/**
 * Match strength: name in headline 1.0, alias in headline 0.8,
 * anything only in summary 0.5. Exclude terms veto the match.
 */
export function matchEntity(
  entity: Watchable,
  headline: string,
  summary: string,
): MatchResult | null {
  const both = `${headline} ${summary}`;
  for (const ex of entity.exclude_terms ?? []) {
    if (containsTerm(both, ex)) return null;
  }
  // Mask only occurrences belonging to another entity, preserving independent company mentions.
  const maskNames = (text: string) =>
    (entity.excluded_name_phrases ?? []).reduce((out, phrase) => {
      const tokens = phrase.match(/[\p{L}\p{N}]+/gu);
      if (!tokens?.length) return out;
      const pattern = tokens.map(escapeRe).join("[\\s\\p{P}]+");
      return out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"), " ");
    }, text);
  const matchingHeadline = maskNames(headline),
    matchingSummary = maskNames(summary);
  const matchingText = `${matchingHeadline} ${matchingSummary}`;
  const hasContext = (entity.context_terms ?? []).some((term) => {
    if (!term.endsWith("*")) return containsTerm(matchingText, term);
    const prefix = term.slice(0, -1).trim();
    return (
      prefix.length >= 3 &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(prefix)}[\\p{L}\\p{N}]*`, "iu").test(matchingText)
    );
  });
  const ambiguous = new Set(
    (entity.ambiguous_terms ?? []).map((term) => term.trim().toLowerCase()),
  );
  const terms: string[] = [];
  let strength = 0;
  const check = (term: string, cs: boolean, headlineScore: number) => {
    if (ambiguous.has(term.trim().toLowerCase()) && !hasContext) return;
    if (containsTerm(matchingHeadline, term, cs)) {
      terms.push(term);
      strength = Math.max(strength, headlineScore);
    } else if (containsTerm(matchingSummary, term, cs)) {
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
export function relevanceScore(
  sourceWeight: number,
  strength: number,
  publishedAt: Date,
  now = new Date(),
): number {
  const ageH = (now.getTime() - publishedAt.getTime()) / 36e5;
  const recency = ageH <= 24 ? 0.1 : ageH <= 72 ? 0.05 : 0;
  return Math.round((sourceWeight * 0.5 + strength * 0.4 + recency) * 100) / 100;
}

export function buildCitation(i: {
  publisher: string;
  headline: string;
  canonical_url: string;
  published_at: string;
}): string {
  const d = new Date(i.published_at);
  const date = d.toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" });
  return `${i.publisher}: "${i.headline}", ${date}. ${i.canonical_url}`;
}

export function isLexArticleUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      url.hostname === "lex.dk" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export function googleNewsUrl(companyName: string, aliases: string[] = []): string {
  const query = [...new Set([companyName, ...aliases])]
    .filter((s) => s.trim())
    .sort()
    .map((term) => `"${term.replace(/"/g, "")}"`)
    .join(" OR ");
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=da&gl=DK&ceid=DK:da`;
}

export function buildMatches(
  companies: Watchable[],
  topics: { id: string; keywords: string[] }[],
  item: { headline: string; summary: string | null; published_at: string },
  sourceWeight: number,
  now = new Date(),
  sourceCompanyId?: string | null,
) {
  const matches: {
    company_id: string | null;
    topic_id: string | null;
    matched_terms: string[];
    relevance_score: number;
  }[] = [];
  const score = (strength: number) =>
    relevanceScore(sourceWeight, strength, new Date(item.published_at), now);
  for (const company of companies) {
    const excluded = (company.exclude_terms ?? []).some((term) =>
      containsTerm(`${item.headline} ${item.summary ?? ""}`, term),
    );
    // An explicitly linked first-party feed is evidence even without a name in the headline.
    const match =
      matchEntity(company, item.headline, item.summary ?? "") ??
      (company.id === sourceCompanyId && !excluded
        ? { id: company.id, terms: [`Kilde: ${company.name}`], strength: 0.8 }
        : null);
    if (match)
      matches.push({
        company_id: company.id,
        topic_id: null,
        matched_terms: match.terms,
        relevance_score: score(match.strength),
      });
  }
  for (const topic of topics) {
    const hits = topic.keywords.flatMap((keyword) => {
      const match = matchEntity(
        { id: topic.id, name: keyword, aliases: [] },
        item.headline,
        item.summary ?? "",
      );
      return match ? [match] : [];
    });
    if (hits.length)
      matches.push({
        company_id: null,
        topic_id: topic.id,
        matched_terms: [...new Set(hits.flatMap((hit) => hit.terms))],
        relevance_score: score(Math.max(...hits.map((hit) => hit.strength))),
      });
  }
  return matches;
}
