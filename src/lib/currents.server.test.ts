import { testCurrentsRequest } from "@/test/currents-transport";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentsLatestNews } from "./currents.server";

afterEach(() => vi.unstubAllGlobals());

describe("Currents latest news", () => {
  it("does not request news without a configured key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchCurrentsLatestNews(undefined, testCurrentsRequest);
    expect(result.news).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the fixed Currents endpoint and returns only news fields", async () => {
    const article = {
      id: "news-1",
      title: "Research update",
      description: "Trial results",
      url: "https://lex.dk/",
      author: "Editor",
      image: null,
      language: "en",
      category: ["science"],
      published: "2026-11-24 12:00:00 +0000",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        status: "ok",
        news: [{ ...article, internal: "not returned" }],
        extra: "not returned",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchCurrentsLatestNews("test-only-credential", testCurrentsRequest);
    expect(result).toEqual({ news: [article], error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.currentsapi.services/v1/latest-news",
      expect.objectContaining({
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([302, 401, 403, 429, 500])(
    "safely handles HTTP %s without exposing provider details",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("private provider details", { status })),
      );
      const result = await fetchCurrentsLatestNews("test-only-credential", testCurrentsRequest);
      expect(result.news).toEqual([]);
      expect(result.error).toBeTruthy();
      expect(JSON.stringify(result)).not.toContain("private provider details");
    },
  );

  it("rejects unexpected API response shapes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "ok", news: [{}] })));
    expect(
      (await fetchCurrentsLatestNews("test-only-credential", testCurrentsRequest)).error,
    ).toBeTruthy();
  });

  it("handles network failures without exposing exception details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private request details")));
    const result = await fetchCurrentsLatestNews("test-only-credential", testCurrentsRequest);
    expect(result.news).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("private request details");
  });
});
