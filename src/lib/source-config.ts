import { z } from "zod";

export const connectors = ["rss", "clinicaltrials", "pubmed"] as const;
export type Connector = (typeof connectors)[number];

/** Return null when the provider's requested delay exceeds this HTTP job's budget. */
export function rateLimitDelay(
  retryAfter: string | null,
  attempt: number,
  now = Date.now(),
): number | null {
  let delay = 2_000 * 2 ** attempt;
  if (retryAfter?.trim()) {
    const seconds = Number(retryAfter);
    const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(parsed)) delay = Math.max(0, parsed);
  }
  return delay > 30_000 ? null : delay;
}

/** Only these publishers (and their subdomains) may be fetched; extend deliberately in code review. */
export const allowedSourceDomains = [
  "clinicaltrials.gov",
  "ncbi.nlm.nih.gov",
  "genmab.com",
  "laegemiddelstyrelsen.dk",
  "news.google.com",
  "ema.europa.eu",
  "fda.gov",
  "fiercepharma.com",
  "globenewswire.com",
  "nordicbioscience.com",
  "uniontherapeutics.com",
  "bioporto.com",
  "ferrosanmedicaldevices.com",
] as const;

export function isAllowedSourceHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowedSourceDomains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Validate source addresses and every redirect before fetching. */
export function publicSourceUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    host.includes(":") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    throw new Error("Kilden skal bruge en offentlig HTTPS-adresse uden login eller særlig port.");
  }
  return url;
}

/** Addresses the server may actually fetch: public HTTPS on an approved publisher domain. */
export function approvedSourceUrl(value: string): URL {
  const url = publicSourceUrl(value);
  if (!isAllowedSourceHost(url.hostname)) {
    throw new Error(`Domænet ${url.hostname} er ikke på listen over godkendte kilder.`);
  }
  return url;
}

export const sourceSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    publisher: z.string().trim().min(1).max(200),
    url: z.string().url().max(4000),
    source_weight: z.number().min(0).max(1),
    connector: z.enum(connectors),
  })
  .superRefine((source, ctx) => {
    try {
      const url = approvedSourceUrl(source.url);
      if (
        source.connector === "clinicaltrials" &&
        (url.hostname !== "clinicaltrials.gov" ||
          url.pathname !== "/api/v2/studies" ||
          !url.searchParams.get("query.spons"))
      ) {
        throw new Error(
          "Brug ClinicalTrials.gov /api/v2/studies med query.spons til valg af sponsorer.",
        );
      }
      if (
        source.connector === "pubmed" &&
        (url.hostname !== "eutils.ncbi.nlm.nih.gov" ||
          url.pathname !== "/entrez/eutils/esearch.fcgi" ||
          !url.searchParams.get("term"))
      ) {
        throw new Error("Brug NCBI ESearch med term til valg af PubMed-søgning.");
      }
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: error instanceof Error ? error.message : "Ugyldig kilde",
      });
    }
  });
