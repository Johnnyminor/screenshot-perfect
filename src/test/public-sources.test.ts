// @vitest-environment node
// Optional network smoke test. Never connects to the application database.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFeed, parseTrials, parsePubmed, pubmedSearchSchema } from "@/lib/source-parsers";

const sql = readFileSync(
  new URL("../../drizzle/migrations/0001_collection_reliability.sql", import.meta.url),
  "utf8",
);
const sources = [
  ...sql.matchAll(/\('([^']+)','(https:\/\/[^']+)','([^']+)',([0-9.]+)(?:,'([^']+)')?\)/g),
].map((match) => ({ name: match[1]!, url: match[2]!, connector: match[5] ?? "rss" }));
describe.skipIf(process.env["VERIFY_PUBLIC_SOURCES"] !== "1")("configured public sources", () => {
  it.each(sources)(
    "fetches and parses $name",
    async (source) => {
      const url = new URL(source.url);
      if (source.connector === "clinicaltrials") url.searchParams.set("pageSize", "2");
      if (source.connector === "pubmed") {
        for (const [key, value] of Object.entries({
          db: "pubmed",
          retmode: "json",
          retmax: "2",
          datetype: "edat",
          reldate: "30",
        }))
          url.searchParams.set(key, value);
      }
      const response = await fetch(url, {
        headers: { "User-Agent": "LexNyhedsmonitor/1.0 (+https://lex.dk)" },
        signal: AbortSignal.timeout(10000),
      });
      expect(response.ok, `${source.name}: HTTP ${response.status}`).toBe(true);
      if (source.connector === "clinicaltrials") {
        const { items } = parseTrials(await response.json());
        expect(items.length).toBeGreaterThan(0);
      } else if (source.connector === "pubmed") {
        const search = pubmedSearchSchema.parse(await response.json()).esearchresult;
        expect(search.idlist.length).toBeGreaterThan(0);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const details = await fetch(
          `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${search.idlist.join(",")}`,
          { signal: AbortSignal.timeout(10000) },
        );
        expect(details.ok).toBe(true);
        expect(parsePubmed(await details.text())).toHaveLength(search.idlist.length);
      } else expect(parseFeed(await response.text()).length).toBeGreaterThan(0);
    },
    25000,
  );
});
