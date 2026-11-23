import { z } from "zod";

export const connectors = ["rss", "clinicaltrials", "pubmed"] as const;
export type Connector = (typeof connectors)[number];

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
      const url = publicSourceUrl(source.url);
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
