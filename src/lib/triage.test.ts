import { describe, expect, it } from "vitest";
import { canonicalizeUrl, matchEntity, normalizeHeadline, relevanceScore } from "./triage";

describe("dedup on canonical URL", () => {
  it("strips tracking params, fragment and trailing slash", () => {
    expect(canonicalizeUrl("http://WWW.Example.com/a/b/?utm_source=x&id=2#top")).toBe(
      "https://www.example.com/a/b?id=2",
    );
  });
  it("treats http and https copies of the same story as one", () => {
    expect(canonicalizeUrl("http://x.dk/s")).toBe(canonicalizeUrl("https://x.dk/s?utm_medium=rss"));
  });
  it("strips the Google News publisher suffix from headlines", () => {
    expect(normalizeHeadline("Novo hæver forventninger - Børsen", "Børsen")).toBe(
      normalizeHeadline("Novo hæver forventninger"),
    );
  });
});

describe("keyword/alias matching", () => {
  const gn = { id: "gn", name: "GN Store Nord", aliases: ["Jabra"], case_sensitive_aliases: ["GN"] };
  it("matches acronym aliases only in upper case", () => {
    expect(matchEntity(gn, "GN lifts guidance", "")).not.toBeNull();
    expect(matchEntity(gn, "Gn and others", "")).toBeNull();
  });
  it("does not match inside other words", () => {
    expect(matchEntity({ id: "a", name: "Ambu", aliases: [] }, "Ambulance services grow", "")).toBeNull();
  });
  it("exclude terms veto a match", () => {
    expect(
      matchEntity({ id: "a", name: "Abbott", aliases: [], exclude_terms: ["Greg Abbott"] }, "Greg Abbott signs bill", ""),
    ).toBeNull();
  });
  it("name in headline scores stronger than summary-only", () => {
    const e = { id: "c", name: "Coloplast", aliases: [] };
    expect(matchEntity(e, "Coloplast buys firm", "")?.strength).toBe(1);
    expect(matchEntity(e, "Firm sold", "Coloplast is buyer")?.strength).toBe(0.5);
  });
});

describe("relevance score", () => {
  it("weights source 50%, match 40%, recency 10%", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(relevanceScore(1, 1, new Date("2026-10-27T10:00:00Z"), now)).toBe(1);
    expect(relevanceScore(0.5, 0.5, new Date("2026-10-01T10:00:00Z"), now)).toBe(0.45);
  });
});
