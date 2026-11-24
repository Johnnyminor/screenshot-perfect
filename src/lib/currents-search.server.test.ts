// @vitest-environment node
import { afterEach, it, expect, vi } from "vitest";
import { fetchCurrentsSearch, parseCurrents } from "./currents-search.server";
import { sourceSchema } from "./source-config";
const configured = "https://api.currentsapi.services/v1/search?query=%22Ambu%22&language=da";
afterEach(() => vi.unstubAllGlobals());
it("uses a bounded seven-day search with header credentials and no redirects", async () => {
  const request = vi.fn(async () => Response.json({ status: "ok", news: [] }));
  vi.stubGlobal("fetch", request);
  expect(
    await fetchCurrentsSearch(configured, "secret", Date.parse("2026-11-24T12:00:00Z")),
  ).toEqual([]);
  const [raw, options] = request.mock.calls[0]! as unknown as [string, RequestInit];
  const url = new URL(raw);
  expect(url.hostname).toBe("api.currentsapi.services");
  expect(url.searchParams.get("query")).toBe('"Ambu"');
  expect(url.searchParams.get("language")).toBe("da");
  expect(url.searchParams.get("start_date")).toBe("2026-11-17T12:00:00.000Z");
  expect(url.searchParams.get("page_size")).toBe("20");
  expect(raw).not.toContain("secret");
  expect(options).toMatchObject({
    redirect: "manual",
    headers: { Authorization: "Bearer secret" },
  });
});
it.each([302, 401, 403, 429, 500])("fails explicitly and sanitizes HTTP %s", async (status) => {
  const request = vi.fn(async () => new Response("secret reflected by provider", { status }));
  vi.stubGlobal("fetch", request);
  await expect(fetchCurrentsSearch(configured, "secret")).rejects.not.toThrow("secret");
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects URLs that could leak the key or alter pilot controls", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  for (const url of [
    configured + "&apiKey=secret",
    configured.replace("/v1/search", "/v1/latest-news"),
    configured.replace("api.currentsapi.services", "evil.example"),
  ]) {
    await expect(fetchCurrentsSearch(url, "secret")).rejects.toThrow();
  }
  expect(request).not.toHaveBeenCalled();
  expect(
    sourceSchema.safeParse({
      name: "test",
      publisher: "test",
      source_weight: 0.6,
      connector: "rss",
      url: configured,
    }).success,
  ).toBe(false);
});
it("distinguishes malformed/error responses from valid zero results", () => {
  expect(parseCurrents({ status: "ok", news: [] })).toEqual([]);
  expect(() => parseCurrents({ status: "error", news: [] })).toThrow();
  expect(() =>
    parseCurrents({
      status: "ok",
      news: [
        {
          id: "1",
          title: "Trial",
          url: "https://publisher.example/a",
          published: "unknown",
          language: "en",
        },
      ],
    }),
  ).toThrow();
});
