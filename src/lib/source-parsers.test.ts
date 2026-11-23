import { describe, expect, it } from "vitest";
import { parseFeed, parseTrials, parsePubmed, pubmedSearchSchema } from "./source-parsers";
import { publicSourceUrl, sourceSchema } from "./source-config";

describe("feed validation", () => {
  it("rejects an HTML error page returned with HTTP 200", () => {
    expect(() => parseFeed("<html><body>Access denied</body></html>")).toThrow(
      "hverken RSS eller Atom",
    );
  });
  it("rejects malformed XML and document types", () => {
    expect(() => parseFeed("<rss><channel></rss>")).toThrow();
    expect(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "bad">]><rss><channel/></rss>')).toThrow();
  });
  it("accepts an empty RSS channel", () =>
    expect(parseFeed("<rss><channel><title>Empty</title></channel></rss>")).toEqual([]));
  it("extracts RSS provenance and decodes query-string entities", () => {
    const [item] = parseFeed(
      "<rss><channel><item><title>News - Publisher</title><link>https://example.com/?a=1&amp;b=2</link><source>Publisher</source><description>&lt;p&gt;Text&lt;/p&gt;</description></item></channel></rss>",
    );
    expect(item).toMatchObject({
      publisher: "Publisher",
      link: "https://example.com/?a=1&b=2",
      summary: "Text",
      publishedAt: null,
    });
  });
  it("extracts an Atom alternate link instead of the edit link", () => {
    const [item] = parseFeed(
      '<feed><entry><title>News</title><link rel="edit" href="https://example.com/edit"/><link rel="alternate" href="https://example.com/story"/><updated>2026-11-20T12:00:00Z</updated></entry></feed>',
    );
    expect(item?.link).toBe("https://example.com/story");
    expect(item?.publishedAt?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });
  it("rejects feed entries that cannot be stored", () =>
    expect(() =>
      parseFeed("<rss><channel><item><title>No URL</title></item></channel></rss>"),
    ).toThrow());
});

describe("ClinicalTrials.gov normalization", () => {
  it("uses a stable study URL and last-update date with sponsor in the headline", () => {
    const parsed = parseTrials({
      studies: [
        {
          protocolSection: {
            identificationModule: { nctId: "NCT01234567", briefTitle: "Trial title" },
            sponsorCollaboratorsModule: { leadSponsor: { name: "Genmab" } },
            statusModule: {
              overallStatus: "RECRUITING",
              lastUpdatePostDateStruct: { date: "2026-11-20" },
            },
            descriptionModule: { briefSummary: "Trial summary" },
          },
        },
      ],
      nextPageToken: "next",
    });
    expect(parsed.items[0]).toMatchObject({
      headline: "Genmab: Trial title",
      link: "https://clinicaltrials.gov/study/NCT01234567",
      summary: "RECRUITING. Trial summary",
    });
    expect(parsed.items[0]?.publishedAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(parsed.nextPageToken).toBe("next");
  });
  it("does not treat an API error as an empty successful response", () =>
    expect(() => parseTrials({ error: "unavailable" })).toThrow());
});

describe("PubMed normalization", () => {
  it("extracts affiliations, abstract, stable PMID and first indexed date", () => {
    const xml =
      '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>12345</PMID><Article><ArticleTitle>A discovery</ArticleTitle><AuthorList><Author><AffiliationInfo><Affiliation>Genmab, Copenhagen</Affiliation></AffiliationInfo></Author></AuthorList><Abstract><AbstractText>Research findings</AbstractText></Abstract></Article></MedlineCitation><PubmedData><History><PubMedPubDate PubStatus="pubmed"><Year>2026</Year><Month>11</Month><Day>20</Day></PubMedPubDate></History></PubmedData></PubmedArticle></PubmedArticleSet>';
    const [item] = parsePubmed(xml);
    expect(item).toMatchObject({
      headline: "A discovery",
      link: "https://pubmed.ncbi.nlm.nih.gov/12345/",
      summary: "Genmab, Copenhagen · Research findings",
    });
    expect(item?.publishedAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
  it("rejects API errors instead of reporting a successful empty search", () => {
    expect(() => pubmedSearchSchema.parse({ error: "rate limit" })).toThrow();
    expect(() => parsePubmed("<eFetchResult><ERROR>Bad query</ERROR></eFetchResult>")).toThrow();
  });
});

describe("source configuration", () => {
  it.each([
    "http://example.com/feed",
    "https://127.0.0.1/feed",
    "https://[::1]/feed",
    "https://localhost/feed",
    "https://host.local/feed",
    "https://user:pass@example.com/feed",
    "https://example.com:8443/feed",
  ])("rejects unsafe target %s", (url) => expect(() => publicSourceUrl(url)).toThrow());
  it("restricts the API connector to the official endpoint with a sponsor search", () => {
    const base = {
      name: "Trials",
      publisher: "ClinicalTrials.gov",
      source_weight: 0.9,
      connector: "clinicaltrials",
    };
    expect(sourceSchema.safeParse({ ...base, url: "https://example.com/api" }).success).toBe(false);
    expect(
      sourceSchema.safeParse({
        ...base,
        url: "https://clinicaltrials.gov/api/v2/studies?query.spons=Genmab",
      }).success,
    ).toBe(true);
  });
});

describe("source domain allowlist", () => {
  it("accepts approved publishers and subdomains", () => {
    expect(publicSourceUrl("https://www.fda.gov/rss.xml").hostname).toBe("www.fda.gov");
  });
  it("rejects unapproved domains", () => {
    expect(() => publicSourceUrl("https://attacker.example.com/feed")).toThrow();
    expect(() => publicSourceUrl("https://fda.gov.evil.com/feed")).toThrow();
  });
});
