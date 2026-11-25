import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { stripHtml } from "./triage";

export type ParsedItem = {
  headline: string;
  link: string;
  publishedAt: Date | null;
  summary: string;
  publisher?: string | undefined;
};
export const pubmedSearchSchema = z.object({
  esearchresult: z.object({
    count: z.string().regex(/^\d+$/),
    idlist: z.array(z.string().regex(/^\d+$/)),
  }),
});

export function parsePubmed(xml: string): ParsedItem[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true)
    throw new Error(
      `PubMed returnerede ugyldig XML (${validation.err.code}, linje ${validation.err.line}, kolonne ${validation.err.col}).`,
    );
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    stopNodes: ["*.ArticleTitle", "*.AbstractText", "*.Affiliation"],
  }).parse(xml);
  if (!doc?.PubmedArticleSet) throw new Error("PubMed returnerede ikke artikler.");
  return arr(doc.PubmedArticleSet.PubmedArticle).map((record) => {
    const citation = record.MedlineCitation,
      article = citation?.Article;
    const id = text(citation?.PMID),
      title = stripHtml(text(article?.ArticleTitle));
    if (!/^\d+$/.test(id) || !title) throw new Error("PubMed-artiklen mangler ID eller titel.");
    const history = arr(record.PubmedData?.History?.PubMedPubDate);
    const date =
      history.find((entry: Record<string, string>) => entry["@_PubStatus"] === "pubmed") ??
      arr(article.ArticleDate)[0];
    const published = date
      ? new Date(
          `${text(date.Year)}-${text(date.Month).padStart(2, "0")}-${text(date.Day).padStart(2, "0")}T00:00:00Z`,
        )
      : null;
    const affiliations = arr(article.AuthorList?.Author).flatMap((author) =>
      arr(author.AffiliationInfo).map((info) => text(info.Affiliation)),
    );
    const abstract = arr(article.Abstract?.AbstractText).map(text).join(" ");
    return {
      headline: title,
      link: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      publishedAt: published,
      summary: stripHtml([...new Set(affiliations), abstract].filter(Boolean).join(" · ")).slice(
        0,
        1000,
      ),
    };
  });
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return String(value["#text"]);
  return "";
}
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function parseFeed(xml: string): ParsedItem[] {
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE/i.test(xml))
    throw new Error("Kilden returnerede ugyldig XML eller en dokumenttype.");
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  if (!doc?.rss?.channel && !doc?.["rdf:RDF"] && !doc?.feed)
    throw new Error("Kilden returnerede hverken RSS eller Atom.");
  const out: ParsedItem[] = [];
  for (const item of arr(doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item)) {
    const date = text(item.pubDate) || text(item["dc:date"]);
    out.push({
      headline: stripHtml(text(item.title)),
      link: text(item.link) || text(item.guid),
      publishedAt: date ? new Date(date) : null,
      summary: stripHtml(text(item.description)).slice(0, 1000),
      publisher: text(item.source) || undefined,
    });
  }
  for (const entry of arr(doc?.feed?.entry)) {
    const links = arr(entry.link);
    const alternate =
      links.find(
        (link: Record<string, string>) => !link["@_rel"] || link["@_rel"] === "alternate",
      ) ?? links[0];
    const date = text(entry.published) || text(entry.updated);
    out.push({
      headline: stripHtml(text(entry.title)),
      link: typeof alternate === "string" ? alternate : (alternate?.["@_href"] ?? ""),
      publishedAt: date ? new Date(date) : null,
      summary: stripHtml(text(entry.summary) || text(entry.content)).slice(0, 1000),
    });
  }
  if (out.some((item) => !item.headline || !item.link))
    throw new Error("Feedet indeholder poster uden titel eller link.");
  return out;
}

const trialSchema = z.object({
  studies: z.array(
    z.object({
      protocolSection: z.object({
        identificationModule: z.object({
          nctId: z.string().regex(/^NCT\d+$/),
          briefTitle: z.string().min(1),
        }),
        sponsorCollaboratorsModule: z.object({ leadSponsor: z.object({ name: z.string() }) }),
        statusModule: z.object({
          overallStatus: z.string(),
          lastUpdatePostDateStruct: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
        }),
        descriptionModule: z.object({ briefSummary: z.string().optional() }).optional(),
      }),
    }),
  ),
  nextPageToken: z.string().optional(),
});
export function parseTrials(body: unknown): {
  items: ParsedItem[];
  nextPageToken?: string | undefined;
} {
  const data = trialSchema.parse(body);
  return {
    nextPageToken: data.nextPageToken,
    items: data.studies.map(({ protocolSection: p }) => ({
      headline: `${p.sponsorCollaboratorsModule.leadSponsor.name}: ${p.identificationModule.briefTitle}`,
      link: `https://clinicaltrials.gov/study/${p.identificationModule.nctId}`,
      publishedAt: new Date(`${p.statusModule.lastUpdatePostDateStruct.date}T00:00:00Z`),
      summary:
        `${p.statusModule.overallStatus}. ${stripHtml(p.descriptionModule?.briefSummary ?? "")}`.slice(
          0,
          1000,
        ),
    })),
  };
}
