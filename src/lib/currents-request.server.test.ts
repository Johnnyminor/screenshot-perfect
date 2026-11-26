// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createCurrentsRequest, CurrentsQuotaError } from "./currents-request.server";

function account(allow = true) {
  const updates: unknown[] = [];
  let started = false;
  const rpc = vi.fn(async (name: string) => {
    if (name === "reserve_currents_request")
      return { data: allow ? "reservation" : null, error: null };
    const allowed = !started;
    started = true;
    return { data: allowed, error: null };
  });
  const admin = {
    rpc,
    from: () => ({
      update: (patch: unknown) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  } as unknown as SupabaseClient<Database>;
  return { admin, rpc, updates };
}
afterEach(() => vi.unstubAllGlobals());

it("never sends HTTP after quota exhaustion or invalid destination/configuration", async () => {
  const http = vi.fn();
  vi.stubGlobal("fetch", http);
  const { admin, rpc } = account(false);
  const request = createCurrentsRequest(admin, "preview");
  await expect(
    request("https://api.currentsapi.services/v1/latest-news", "key"),
  ).rejects.toBeInstanceOf(CurrentsQuotaError);
  rpc.mockClear();
  await expect(request("https://evil.example/v1/latest-news", "key")).rejects.toThrow();
  await expect(request("https://api.currentsapi.services/v1/latest-news", "")).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
  expect(http).not.toHaveBeenCalled();
});

it("keeps uncertain attempts consumed and does not replay an evaluation reservation", async () => {
  const http = vi.fn(async () => {
    throw new Error("private key reflected in error");
  });
  vi.stubGlobal("fetch", http);
  const { admin, rpc, updates } = account();
  const request = createCurrentsRequest(admin, "evaluation", "reserved-by-evaluation");
  await expect(
    request("https://api.currentsapi.services/v1/search?query=Test", "key"),
  ).rejects.toThrow("Currents kunne ikke kontaktes");
  await expect(
    request("https://api.currentsapi.services/v1/search?query=Test", "key"),
  ).rejects.toThrow("allerede brugt");
  expect(http).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls.some(([name]) => name === "reserve_currents_request")).toBe(false);
  expect(updates).toContainEqual(expect.objectContaining({ status: "uncertain" }));
  expect(JSON.stringify(updates)).not.toContain("key");
});

it("records bounded provider quota metadata without response bodies or credentials", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("private body", {
          headers: { "x-ratelimit-limit": "250", "x-ratelimit-remaining": "49" },
        }),
    ),
  );
  const { admin, updates } = account();
  await createCurrentsRequest(admin, "ingest")(
    "https://api.currentsapi.services/v1/search?query=Test",
    "key",
  );
  expect(updates).toContainEqual(
    expect.objectContaining({
      status: "response",
      http_status: 200,
      provider_limit: 250,
      provider_remaining: 49,
    }),
  );
  expect(JSON.stringify(updates)).not.toContain("private body");
});
