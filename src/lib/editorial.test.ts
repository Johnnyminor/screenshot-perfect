import { describe, expect, it } from "vitest";
import { buildCitation, isLexArticleUrl } from "./triage";

describe("editorial traceability", () => {
  it("requires a real Lex article address before registering use", () => {
    expect(isLexArticleUrl("https://lex.dk/Bavarian_Nordic")).toBe(true);
    for (const value of [
      "",
      "not a link",
      "https://evil.example/lex.dk",
      "https://lex.dk.evil.example/article",
      "https://lex.dk/",
      "http://lex.dk/article",
      "https://user:password@lex.dk/article",
    ])
      expect(isLexArticleUrl(value)).toBe(false);
  });
  it("carries the publisher, exact headline, publication date and original URL into a citation", () => {
    expect(
      buildCitation({
        publisher: "Bavarian Nordic",
        headline: "Vaccine contract",
        published_at: "2026-11-02T00:00:00Z",
        canonical_url: "https://www.bavarian-nordic.com/investor/news/news.aspx?news=7621",
      }),
    ).toBe(
      'Bavarian Nordic: "Vaccine contract", 2. november 2026. https://www.bavarian-nordic.com/investor/news/news.aspx?news=7621',
    );
  });
});
