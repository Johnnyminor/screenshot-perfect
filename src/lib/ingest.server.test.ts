// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checked, runIngest } from "./ingest.server";
import { rateLimitDelay } from "./source-config";

type Call = { table: string; operation: string; value?: unknown };
function fakeAdmin({
  failWrite = false,
  failRead = false,
  google = false,
  copies = 1,
  cooldown = false,
  future = false,
  includePrimary = false,
  pubmedCached = false,
  pubmedNew = false,
  owned = false,
  cursor = {} as { offset?: number },
  currents = false,
  budget = true,
} = {}) {
  const calls: Call[] = [];
  const feed = {
    id: "feed",
    name: "Example",
    url: currents
      ? "https://api.currentsapi.services/v1/search?query=%22Example%22&language=en"
      : pubmedCached || pubmedNew
        ? "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?term=Genmab"
        : google
          ? "https://news.google.com/rss/search?q=Example"
          : "https://www.fda.gov/feed",
    publisher: "Example",
    connector: currents ? "currents" : pubmedCached || pubmedNew ? "pubmed" : "rss",
    kind: "static",
    company_id: owned ? "owner" : null,
    source_weight: 0.8,
    active: true,
    etag: '"old"',
    last_modified: null,
    consecutive_failures: 0,
    poll_interval_minutes: google ? 180 : 15,
    next_poll_at: future ? new Date(Date.now() + 3600_000).toISOString() : null,
  };
  const feeds = Array.from({ length: copies }, (_, i) => ({ ...feed, id: `feed-${i}` }));
  if (includePrimary)
    feeds.push({
      ...feed,
      id: "primary",
      url: "https://www.fda.gov/feed",
      poll_interval_minutes: 15,
    });
  let rematched = false;
  const companies = owned
    ? [{ id: "owner", name: "Nordic Bioscience", aliases: [], exclude_terms: [] }]
    : [];
  const admin = {
    from(table: string) {
      let operation = "select",
        value: unknown,
        single = false,
        selection = "*";
      const builder = {
        select(columns = "*") {
          selection = columns;
          return builder;
        },
        eq() {
          return builder;
        },
        gt() {
          return builder;
        },
        gte() {
          return builder;
        },
        in() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        update(patch: unknown) {
          operation = "update";
          value = patch;
          return builder;
        },
        upsert(patch: unknown) {
          operation = "upsert";
          value = patch;
          return builder;
        },
        then(resolve: (result: unknown) => unknown) {
          calls.push({ table, operation, value });
          const error =
            failRead && table === "companies" ? { message: "Database unavailable" } : null;
          const data =
            operation !== "select"
              ? null
              : table === "feeds"
                ? feeds
                : table === "items" && single
                  ? null
                  : table === "provider_health" && cooldown
                    ? [
                        {
                          hostname: "news.google.com",
                          blocked_until: new Date(Date.now() + 3600_000).toISOString(),
                          last_error: "HTTP 503",
                          consecutive_failures: 1,
                        },
                      ]
                    : table === "companies" && owned
                      ? [{ id: "owner", name: "Nordic Bioscience", aliases: [], exclude_terms: [] }]
                      : table === "items" && owned && !single
                        ? [
                            {
                              id: "archived",
                              headline: "Research update",
                              summary: null,
                              published_at: new Date().toISOString(),
                              feed_id: "feed-0",
                            },
                          ]
                        : table === "items" && pubmedCached && selection === "id,canonical_url"
                          ? [
                              {
                                id: "cached",
                                canonical_url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
                              },
                            ]
                          : [];
          return Promise.resolve({ data, error }).then(resolve);
        },
      };
      return builder;
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "matching_snapshot")
        return failRead
          ? { data: null, error: { message: "Database unavailable" } }
          : { data: { revision: 1, companies, topics: [], feeds }, error: null };
      if (name === "claim_source_job")
        return {
          data: { id: "job", lease_token: "token", cursor, created_at: new Date().toISOString() },
          error: null,
        };
      if (["checkpoint_source_job", "finish_source_job", "start_currents_request"].includes(name))
        return { data: true, error: null };
      if (name === "reserve_currents_request")
        return { data: budget ? "reservation" : null, error: null };
      if (name === "pending_match_items")
        return {
          data:
            owned && !rematched
              ? [
                  {
                    id: "archived",
                    headline: "Research update",
                    summary: null,
                    published_at: new Date().toISOString(),
                    feed_id: "feed-0",
                  },
                ]
              : [],
          error: null,
        };
      if (name === "replace_matches_batch") {
        rematched = true;
        return { data: 1, error: null };
      }
      if (name === "claim_currents_request") return { data: budget, error: null };
      if (name === "begin_collection") return { data: "run", error: null };
      if (name === "store_job_batch")
        return failWrite
          ? { data: null, error: { message: "Write rejected" } }
          : { data: { created: 1 }, error: null };
      return { data: null, error: null };
    }),
  };
  return { admin: admin as unknown as SupabaseClient<Database>, calls, rpc: admin.rpc };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("collection failure reporting", () => {
  it("yields a slow source job without blocking the next source or advancing its validators", async () => {
    vi.useFakeTimers();
    const fake = fakeAdmin({ copies: 2 });
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (++requests === 1) {
          vi.setSystemTime(Date.now() + 46_000);
          return new Response(
            `<rss><channel><item><title>Slow item</title><link>https://example.com/slow</link></item></channel></rss>`,
            { headers: { etag: '"new"' } },
          );
        }
        return new Response("<rss><channel><title>Empty</title></channel></rss>");
      }),
    );
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 1, deferred: 1, failed: 0 });
    expect(fake.rpc).toHaveBeenCalledWith(
      "finish_source_job",
      expect.objectContaining({ p_status: "pending" }),
    );
    expect(fake.rpc.mock.calls.filter(([name]) => name === "commit_source_success")).toHaveLength(
      1,
    );
    expect(fake.rpc).not.toHaveBeenCalledWith("store_job_batch", expect.anything());
  });

  it("resumes PubMed at the committed offset instead of downloading previous pages", async () => {
    const fake = fakeAdmin({ pubmedCached: true, cursor: { offset: 100 } });
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (raw: string) => {
        requests.push(raw);
        return Response.json({ esearchresult: { count: "100", idlist: [] } });
      }),
    );
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 1, failed: 0 });
    expect(new URL(requests[0]!).searchParams.get("retstart")).toBe("100");
    expect(new URL(requests[0]!).searchParams.has("mindate")).toBe(true);
  });
  it("saves a progress checkpoint before contacting a source", async () => {
    const fake = fakeAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        expect(
          fake.calls.some(
            (call) =>
              call.table === "ingest_runs" &&
              (JSON.stringify(call.value) ?? "").includes("Source: Example"),
          ),
        ).toBe(true);
        return new Response("", { status: 304 });
      }),
    );
    await runIngest(fake.admin);
  });
  it("retries a malformed HTTP-200 PubMed payload once, preserving a warning and storing only valid articles", async () => {
    vi.useFakeTimers();
    const fake = fakeAdmin({ pubmedNew: true });
    let details = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith("esearch.fcgi"))
          return Response.json({ esearchresult: { count: "1", idlist: ["12345"] } });
        details++;
        return new Response(
          details === 1
            ? "<PubmedArticleSet><broken>"
            : `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>12345</PMID><Article><ArticleTitle>Vaccine research update</ArticleTitle><ArticleDate><Year>2026</Year><Month>11</Month><Day>25</Day></ArticleDate></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`,
        );
      }),
    );
    const pending = runIngest(fake.admin);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: 1, failed: 0, newCount: 1 });
    expect(details).toBe(2);
    expect(
      fake.calls.some((call) => (JSON.stringify(call.value) ?? "").includes("payload-warning")),
    ).toBe(true);
    expect(fake.calls.some((call) => (JSON.stringify(call.value) ?? "").includes("<broken>"))).toBe(
      false,
    );
  });
  it("keeps owned-feed company context during storage and archive rematching", async () => {
    const fake = fakeAdmin({ owned: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<rss><channel><item><title>Research update</title><link>https://www.fda.gov/research</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`,
          ),
      ),
    );
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 1, failed: 0 });
    for (const name of ["store_job_batch", "replace_matches_batch"]) {
      expect(fake.rpc).toHaveBeenCalledWith(
        name,
        expect.objectContaining({
          p_records: [
            expect.objectContaining({
              matches: [
                expect.objectContaining({
                  company_id: "owner",
                  matched_terms: ["Kilde: Nordic Bioscience"],
                }),
              ],
            }),
          ],
        }),
      );
    }
  });
  it("opens the Google circuit after one explicit block instead of requesting all company feeds", async () => {
    const fake = fakeAdmin({ google: true, copies: 12 });
    const fetcher = vi.fn(
      async () =>
        new Response("<html><title>Sorry...</title>automated queries</html>", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 0, failed: 1, deferred: 11 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        table: "provider_health",
        operation: "upsert",
        value: expect.objectContaining({ hostname: "news.google.com", last_status: 503 }),
      }),
    );
  });
  it("continues collecting a primary feed while a persisted Google circuit is open", async () => {
    const fake = fakeAdmin({ google: true, copies: 12, cooldown: true, includePrimary: true });
    const fetcher = vi.fn(
      async () => new Response("<rss><channel><title>Empty</title></channel></rss>"),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 1, failed: 0, deferred: 12 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("limits healthy Google collection to six feeds per scheduled run", async () => {
    vi.useFakeTimers();
    const fake = fakeAdmin({ google: true, copies: 12 });
    const fetcher = vi.fn(
      async () => new Response("<rss><channel><title>Empty</title></channel></rss>"),
    );
    vi.stubGlobal("fetch", fetcher);
    const pending = runIngest(fake.admin);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: 6, failed: 0, deferred: 6 });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it("does not fetch a source again before its persisted next-poll time", async () => {
    const fake = fakeAdmin({ future: true });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 0, failed: 0, deferred: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("skips PubMed detail downloads for cached PMIDs and keeps the optional key server-side", async () => {
    const fake = fakeAdmin({ pubmedCached: true });
    vi.stubEnv("NCBI_API_KEY", "test-private-key");
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(JSON.stringify({ esearchresult: { count: "1", idlist: ["12345"] } })),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 1, failed: 0, newCount: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get("api_key")).toBe(
      "test-private-key",
    );
    expect(fake.calls).toContainEqual(
      expect.objectContaining({ table: "item_sources", operation: "upsert" }),
    );
    expect(JSON.stringify(fake.calls)).not.toContain("test-private-key");
  });
  it("honors Retry-After and recovers a throttled Google feed", async () => {
    vi.useFakeTimers();
    const fake = fakeAdmin({ google: true });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Limited", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(new Response("<rss><channel><title>Empty</title></channel></rss>"));
    vi.stubGlobal("fetch", fetcher);
    const started = Date.now(),
      pending = runIngest(fake.admin);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: 1, failed: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
  });
  it("bounds Google retries and reports persistent throttling as a source failure", async () => {
    vi.useFakeTimers();
    const fake = fakeAdmin({ google: true });
    const fetcher = vi.fn(async () => new Response("Limited", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const pending = runIngest(fake.admin);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: 0, failed: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("understands numeric and dated cooldowns and avoids long provider cooldowns", () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    expect(rateLimitDelay("2", 0, now)).toBe(2000);
    expect(rateLimitDelay("Mon, 23 Nov 2026 12:00:05 GMT", 0, now)).toBe(5000);
    expect(rateLimitDelay("60", 0, now)).toBeNull();
    expect(rateLimitDelay("invalid", 1, now)).toBe(4000);
  });
  it("surfaces database read errors instead of returning an empty successful run", async () => {
    const fake = fakeAdmin({ failRead: true });
    await expect(runIngest(fake.admin)).rejects.toThrow("Database unavailable");
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        table: "ingest_runs",
        operation: "update",
        value: expect.objectContaining({ status: "failed" }),
      }),
    );
  });
  it("does not checkpoint cache validators after a rejected story transaction", async () => {
    const fake = fakeAdmin({ failWrite: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<rss><channel><item><title>News</title><link>https://example.com/story</link></item></channel></rss>",
            { headers: { etag: '"new"' } },
          ),
      ),
    );
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 0, failed: 1, newCount: 0 });
    const updates = fake.calls.filter(
      (call) => call.table === "feeds" && call.operation === "update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.value).toMatchObject({
      last_error: "Write rejected",
      consecutive_failures: 1,
    });
    expect(updates[0]?.value).not.toHaveProperty("etag");
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        table: "ingest_runs",
        value: expect.objectContaining({ status: "partial" }),
      }),
    );
  });
  it("marks an HTTP-200 HTML block page as a failed source", async () => {
    const fake = fakeAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>Blocked</body></html>")),
    );
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 0, failed: 1, newCount: 0 });
    expect(fake.rpc).not.toHaveBeenCalledWith("store_job_batch", expect.anything());
  });
  it("handles 304 with no archive downloads when matches are current", async () => {
    const fake = fakeAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304 })),
    );
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 1, failed: 0, newCount: 0 });
    expect(fake.calls.some((call) => call.table === "items" && call.operation === "select")).toBe(
      false,
    );
    expect(fake.rpc).not.toHaveBeenCalledWith("replace_matches_batch", expect.anything());
  });
  it("checked rejects every database error", async () => {
    await expect(
      checked(Promise.resolve({ data: null, error: { message: "failure" } })),
    ).rejects.toThrow("failure");
  });
});

describe("manual Currents ingestion", () => {
  it("keeps Currents out of scheduled and ordinary planned runs", async () => {
    const fake = fakeAdmin({ currents: true });
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await runIngest(fake.admin, { trigger: "schedule", feedIds: ["feed-0"] });
    await runIngest(fake.admin);
    expect(request).not.toHaveBeenCalled();
    expect(fake.rpc.mock.calls.some(([name]) => name === "claim_currents_request")).toBe(false);
  });
  it("defers without HTTP when the persisted pilot budget is exhausted", async () => {
    vi.stubEnv("CURRENTS_API_KEY", "private-key");
    const fake = fakeAdmin({ currents: true, budget: false });
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(await runIngest(fake.admin, { feedIds: ["feed-0"] })).toMatchObject({
      ok: 0,
      failed: 0,
      deferred: 1,
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("stores publisher provenance without forcing the searched company onto unrelated articles", async () => {
    vi.stubEnv("CURRENTS_API_KEY", "private-key");
    const fake = fakeAdmin({ currents: true, owned: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          news: [
            {
              id: "one",
              title: "Research update",
              url: "https://publisher.example/article",
              published: new Date().toISOString(),
              language: "en",
            },
          ],
        }),
      ),
    );
    expect(await runIngest(fake.admin, { feedIds: ["feed-0"] })).toMatchObject({
      ok: 1,
      failed: 0,
    });
    expect(fake.rpc).toHaveBeenCalledWith(
      "store_job_batch",
      expect.objectContaining({
        p_records: [
          expect.objectContaining({
            item: expect.objectContaining({ publisher: "publisher.example" }),
            matches: [],
            refresh: false,
          }),
        ],
      }),
    );
    expect(JSON.stringify(fake.calls)).not.toContain("private-key");
  });
});
