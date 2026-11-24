// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { approvedSourceUrl } from "@/lib/source-config";
import { parseFeed } from "@/lib/source-parsers";

const sql = readFileSync(
  new URL("../../drizzle/migrations/0006_company_rss.sql", import.meta.url),
  "utf8",
);
const sources = [...sql.matchAll(/\('([^']+)','(https:\/\/[^']+)'\)/g)].map((match) => ({
  name: match[1]!,
  url: match[2]!,
}));
it("approves the four company domains while rejecting lookalike hosts", () => {
  expect(sources).toHaveLength(4);
  for (const source of sources) {
    expect(approvedSourceUrl(source.url).protocol).toBe("https:");
    expect(() =>
      approvedSourceUrl(source.url.replace(".com/", ".com.attacker.example/")),
    ).toThrow();
  }
});
describe.skipIf(process.env["VERIFY_COMPANY_FEEDS"] !== "1")("first-party RSS smoke checks", () => {
  it.each(sources)(
    "fetches and parses $name",
    async ({ url }) => {
      const response = await fetch(approvedSourceUrl(url), {
        headers: { "User-Agent": "LexNyhedsmonitor/1.0 (+https://lex.dk)" },
        signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      const items = parseFeed(await response.text());
      expect(items.length).toBeGreaterThan(0);
      expect(
        items.every((item) => item.publishedAt && Number.isFinite(item.publishedAt.getTime())),
      ).toBe(true);
    },
    20000,
  );
});
