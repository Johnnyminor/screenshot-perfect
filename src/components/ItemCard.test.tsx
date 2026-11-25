import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useItemActions } from "./ItemCard";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async (..._args: unknown[]) => ({ error: null })),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: mocks.upsert }) },
}));
vi.mock("@/lib/queries", () => ({ currentUserId: async () => "editor" }));
afterEach(() => {
  cleanup();
  mocks.upsert.mockClear();
});
describe("editorial status metadata", () => {
  it("omits reference and note on a read-status write rather than replacing them with null", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useItemActions(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    act(() => result.current.setStatus.mutate({ itemId: "story", status: "read" }));
    await waitFor(() => expect(result.current.setStatus.isSuccess).toBe(true));
    const patch = mocks.upsert.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(patch).toMatchObject({ item_id: "story", status: "read", user_id: "editor" });
    expect(patch).not.toHaveProperty("article_ref");
    expect(patch).not.toHaveProperty("note");
  });
});
