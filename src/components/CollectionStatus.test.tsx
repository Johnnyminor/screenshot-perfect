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
      await screen.findByText("Tidsplan: intet kald observeret inden for 45 min."),
    ).toBeInTheDocument();
  });
  it("shows a healthy schedule only after a recent fully successful scheduled run", async () => {
    fixtures.stats.scheduled = { status: "completed", started_at: new Date().toISOString() };
    show();
    expect(
      await screen.findByText("Tidsplan: kald observeret inden for 45 min."),
    ).toBeInTheDocument();
  });
  it("separates a recent scheduler call from partial source failures", async () => {
    fixtures.stats.scheduled = { status: "partial", started_at: new Date().toISOString() };
    show();
    expect(
      await screen.findByText("Tidsplan: kald observeret inden for 45 min."),
    ).toBeInTheDocument();
    expect(screen.getByText(/delvist gennemført/)).toBeInTheDocument();
  });
  it("shows a running scheduler without claiming successful source coverage", async () => {
    fixtures.stats.scheduled = { status: "running", started_at: new Date().toISOString() };
    show();
    expect(
      await screen.findByText("Tidsplan: kald observeret inden for 45 min."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Seneste planlagte kørsel: i gang/)).toBeInTheDocument();
  });
});
