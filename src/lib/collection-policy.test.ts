import { describe, it, expect, vi, afterEach } from "vitest";
import { isFeedStale, isProviderCooling, providerCooldown } from "./collection-policy";
import { fetchSource, isAutomatedRequestBlock, retryAfterAt } from "./source-http.server";
afterEach(() => vi.unstubAllGlobals());

describe("provider recovery policy", () => {
  it("revalidates redirects rather than following a source to a private address", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchSource("https://news.google.com/rss/search?q=Example", {})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  const now = Date.parse("2026-11-23T12:00:00Z");
  it("backs off Google across runs and honors a longer provider Retry-After", () => {
    expect(providerCooldown("news.google.com", 503, 1, null, now)).toBe("2026-11-23T13:00:00.000Z");
    expect(providerCooldown("news.google.com", 503, 3, null, now)).toBe("2026-11-23T16:00:00.000Z");
    expect(providerCooldown("news.google.com", 429, 1, now + 48 * 3600_000, now)).toBe(
      "2026-11-25T12:00:00.000Z",
    );
  });
  it("keeps a denied publisher on a daily cooldown rather than retrying every 15 minutes", () => {
    expect(providerCooldown("www.fiercepharma.com", 403, 1, null, now)).toBe(
      "2026-11-24T12:00:00.000Z",
    );
  });
  it("recognizes Google automated-request pages without logging raw response content", () => {
    expect(isAutomatedRequestBlock("<html><title>Sorry...</title></html>")).toBe(true);
    expect(isAutomatedRequestBlock("Service temporarily unavailable")).toBe(false);
  });
  it("recognizes cooldown expiry and freshness relative to the source cadence", () => {
    expect(isProviderCooling({ blocked_until: "2026-11-23T12:30:00Z" }, now)).toBe(true);
    expect(isProviderCooling({ blocked_until: "2026-11-23T11:30:00Z" }, now)).toBe(false);
    expect(
      isFeedStale({ last_success_at: "2026-11-23T11:00:00Z", poll_interval_minutes: 180 }, now),
    ).toBe(false);
    expect(
      isFeedStale({ last_success_at: "2026-11-23T11:00:00Z", poll_interval_minutes: 15 }, now),
    ).toBe(true);
    expect(retryAfterAt("60", now)).toBe(now + 60_000);
  });
});
