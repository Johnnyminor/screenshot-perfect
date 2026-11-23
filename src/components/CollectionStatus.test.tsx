import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { CollectionStatus } from "./CollectionStatus";

const fixtures = vi.hoisted(() => ({
  stats: {
    newToday: 3,
    completed: { finished_at: new Date().toISOString() },
    scheduled: null as null | { status: string; started_at: string },
  },
  feeds: [] as { active: boolean; last_error: string | null; last_success_at: string | null }[],
}));
vi.mock("@/lib/queries", () => ({
  collectionStatsQuery: () => ({ queryKey: ["stats"], queryFn: async () => fixtures.stats }),
  feedsQuery: () => ({ queryKey: ["feeds"], queryFn: async () => fixtures.feeds }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
afterEach(() => {
  cleanup();
  fixtures.stats.scheduled = null;
  fixtures.feeds = [];
});
function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CollectionStatus />
    </QueryClientProvider>,
  );
}
describe("collection status evidence", () => {
  it("does not imply a working schedule after a successful manual collection", async () => {
    show();
    expect(
      await screen.findByText("Planlagt indsamling: nylig succes er ikke bekræftet"),
    ).toBeInTheDocument();
  });
  it("shows a healthy schedule only after a recent fully successful scheduled run", async () => {
    fixtures.stats.scheduled = { status: "completed", started_at: new Date().toISOString() };
    show();
    expect(
      await screen.findByText("Planlagt indsamling observeret inden for 45 min."),
    ).toBeInTheDocument();
  });
  it("does not hide partial failures behind a recent schedule timestamp", async () => {
    fixtures.stats.scheduled = { status: "partial", started_at: new Date().toISOString() };
    show();
    expect(
      await screen.findByText("Planlagt indsamling: nylig succes er ikke bekræftet"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Planlagt indsamling observeret inden for 45 min."),
    ).not.toBeInTheDocument();
  });
});
