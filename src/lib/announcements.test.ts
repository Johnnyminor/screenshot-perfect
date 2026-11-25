import { describe, expect, it } from "vitest";
import { announcementSummary, announcementUrl, parseAnnouncements } from "./announcements";

const listing = `<div class="newslistContainer"><div class="newslist"><div class="articleType"><span class="date">November 23, 2026</span> | <span class="tag">Company Announcements</span></div><a href="http://www.bavarian-nordic.com/investor/news/news.aspx?news=7653">Bavarian Nordic &amp; update</a></div></div>`;
describe("first-party announcements", () => {
  it("extracts dates and decoded headlines, upgrades official HTTP links, and excludes old releases", () => {
    const [item] = parseAnnouncements(listing, Date.parse("2026-11-25"));
    expect(item!.headline).toBe("Bavarian Nordic & update");
    expect(item!.link).toBe("https://www.bavarian-nordic.com/investor/news/news.aspx?news=7653");
    expect(item!.publishedAt!.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(parseAnnouncements(listing, Date.parse("2027-01-01"))).toEqual([]);
  });
  it("rejects changed markup, invalid dates and off-site announcement links", () => {
    expect(() => parseAnnouncements("<h1>Sorry</h1>")).toThrow();
    expect(() => parseAnnouncements(listing.replace("November 23, 2026", "invalid"))).toThrow();
    expect(() => announcementUrl("https://evil.example/?news=7653")).toThrow();
    expect(() =>
      announcementUrl("https://www.bavarian-nordic.com/investor/news/news.aspx?news=1&redirect=x"),
    ).toThrow();
  });
  it("limits summaries to article paragraphs and fails closed on missing content", () => {
    expect(
      announcementSummary(
        '<nav>Unrelated</nav><article class="content"><h1>Title</h1><p>Vaccine <b>contract</b> &amp; growth.</p></article>',
      ),
    ).toBe("Vaccine contract & growth.");
    expect(() => announcementSummary("<p>Blocked</p>")).toThrow();
  });
});
