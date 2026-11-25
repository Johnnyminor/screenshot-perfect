import { describe, expect, it } from "vitest";
import { parseAmbu, parseEuroland, eurolandSummary, parseAlkPress } from "./company-announcements";
import { canonicalizeUrl } from "./triage";
import { sourceSchema } from "./source-config";

const now = Date.parse("2026-11-25T12:00:00Z");
const source =
  "https://tools.eurolandir.com/tools/pressreleases/?companycode=dk-nzmb&v=r2024&lang=en-gb";
describe("priority company announcement adapters", () => {
  it("reads ALK metadata from its own page without inventing a full-text summary", () => {
    const html =
      '<ul class="slider-news-promo-list"><li><div class="views-field-field-date"><div class="field-content">11/19/2026</div></div><div class="views-field-title">ALK research &#248; update</div><a href="https://www.globenewswire.com/news-release/2026/11/19/1/0/en/alk.html">Read more</a></li></ul>';
    const [item] = parseAlkPress(html, now);
    expect(item!.headline).toBe("ALK research ø update");
    expect(item!.publishedAt!.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(item!.summary).toBe("");
    expect(() =>
      parseAlkPress(html.replace("www.globenewswire.com", "evil.example"), now),
    ).toThrow();
    expect(() => parseAlkPress("<h1>Access denied</h1>", now)).toThrow();
  });
  it("keeps distinct Ambu hash-routed releases, dates and decoded content", () => {
    const rows = [2998, 2994].map((id) => ({
      id,
      title: "Company &amp; update",
      textRaw: "<p>Vaccine &#248; update</p>",
      date: "11/23/2026 2:34:00 PM",
      restrictedNews: "False",
    }));
    const items = parseAmbu({ newsList: rows }, now);
    expect(items).toHaveLength(2);
    expect(items[0]!.summary).toBe("Vaccine ø update");
    expect(items[0]!.publishedAt!.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(canonicalizeUrl(items[0]!.link)).not.toBe(canonicalizeUrl(items[1]!.link));
    expect(canonicalizeUrl(items[0]!.link)).toContain("#/ambu-news-item=2998/");
    expect(canonicalizeUrl("https://example.com/story#/ambu-news-item=2998/")).toBe(
      "https://example.com/story",
    );
  });
  it("skips restricted/old Ambu releases and rejects invalid schema/dates", () => {
    const row = {
      id: 2998,
      title: "Company update",
      textRaw: "<p>Text</p>",
      date: "11/23/2026 2:34:00 PM",
      restrictedNews: "True",
    };
    expect(parseAmbu({ newsList: [row] }, now)).toEqual([]);
    expect(
      parseAmbu(
        { newsList: [{ ...row, restrictedNews: "False", date: "1/1/2026 1:00:00 AM" }] },
        now,
      ),
    ).toEqual([]);
    expect(() =>
      parseAmbu(
        { newsList: [{ ...row, restrictedNews: "False", date: "2/31/2026 1:00:00 AM" }] },
        now,
      ),
    ).toThrow();
    expect(() => parseAmbu({ error: "maintenance" }, now)).toThrow();
  });
  it("parses Euroland dates and keeps identity in the configured widget query", () => {
    const [item] = parseEuroland(
      {
        total: 1,
        News: [{ ID: 8178393, title: "Trading by management", date: "\\/Date(1795438174000)\\/" }],
      },
      source,
      now,
    );
    expect(item!.publishedAt!.toISOString()).toBe("2026-11-23T12:49:34.000Z");
    expect(item!.link).toContain("companycode=dk-nzmb");
    expect(item!.link).toContain("ID=8178393");
    expect(
      eurolandSummary(
        '<nav>Noise</nav><div id="SeparateNews-Body"><h1>Company update</h1><p>Growth &amp; progress</p></div>',
      ),
    ).toBe("Growth & progress");
    expect(() => eurolandSummary("<h1>Blocked</h1>")).toThrow();
  });
  it("fails on incomplete Euroland pages and unapproved announcement endpoints", () => {
    expect(() => parseEuroland({ total: 30, News: [] }, source, now)).toThrow("flere sider");
    const config = {
      name: "Test",
      publisher: "Test",
      connector: "announcements",
      source_weight: 0.9,
      url: source,
    };
    expect(sourceSchema.safeParse(config).success).toBe(true);
    expect(
      sourceSchema.safeParse({ ...config, url: source + "&redirect=https://evil.example" }).success,
    ).toBe(false);
    expect(
      sourceSchema.safeParse({ ...config, url: "https://tools.eurolandir.com/arbitrary" }).success,
    ).toBe(false);
  });
});
