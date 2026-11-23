// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checked, runIngest } from "./ingest.server";

type Call = { table: string; operation: string; value?: unknown };
function fakeAdmin({ failWrite = false, failRead = false } = {}) {
  const calls: Call[] = [];
  const feed = {
    id: "feed",
    name: "Example",
    url: "https://example.com/feed",
    publisher: "Example",
    connector: "rss",
    kind: "static",
    source_weight: 0.8,
    active: true,
    etag: '"old"',
    last_modified: null,
    consecutive_failures: 0,
  };
  const admin = {
    from(table: string) {
      let operation = "select",
        value: unknown,
        single = false;
      const builder = {
        select() {
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
        then(resolve: (result: unknown) => unknown) {
          calls.push({ table, operation, value });
          const error =
            failRead && table === "companies" ? { message: "Database unavailable" } : null;
          const data =
            operation === "update"
              ? null
              : table === "feeds"
                ? [feed]
                : table === "items" && single
                  ? null
                  : [];
          return Promise.resolve({ data, error }).then(resolve);
        },
      };
      return builder;
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "begin_collection") return { data: "run", error: null };
      if (name === "store_collected_item")
        return failWrite
          ? { data: null, error: { message: "Write rejected" } }
          : { data: { id: "item", created: true }, error: null };
      return { data: null, error: null };
    }),
  };
  return { admin: admin as unknown as SupabaseClient<Database>, calls, rpc: admin.rpc };
}
afterEach(() => vi.unstubAllGlobals());
describe("collection failure reporting", () => {
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
    expect(fake.rpc).not.toHaveBeenCalledWith("store_collected_item", expect.anything());
  });
  it("handles 304 without fetching stories but still reads the archive for rematching", async () => {
    const fake = fakeAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304 })),
    );
    expect(await runIngest(fake.admin)).toMatchObject({ ok: 1, failed: 0, newCount: 0 });
    expect(fake.calls.some((call) => call.table === "items" && call.operation === "select")).toBe(
      true,
    );
  });
  it("checked rejects every database error", async () => {
    await expect(
      checked(Promise.resolve({ data: null, error: { message: "failure" } })),
    ).rejects.toThrow("failure");
  });
});
