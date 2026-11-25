import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "../routes/_authenticated/overblik";

const fixtures = vi.hoisted(() => ({ fail: false, write: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fixtures.write } }));
vi.mock("@/components/CollectionStatus", () => ({ CollectionStatus: () => null }));
vi.mock("@/components/ItemCard", () => ({
  ItemCard: ({ item }: { item: { headline: string } }) => <article>{item.headline}</article>,
}));
vi.mock("@/lib/queries", () => {
  const companies = [
    { id: "empty", name: "Novonesis", aliases: [], active: true },
    { id: "news", name: "Bavarian Nordic", aliases: [], active: true },
  ];
  const columns = [
    {
      id: "first",
      company_id: "empty",
      topic_id: null,
      sort: "time",
      hide_opinion: true,
      min_score: 0,
    },
    {
      id: "second",
      company_id: "news",
      topic_id: null,
      sort: "time",
      hide_opinion: true,
      min_score: 0,
    },
    {
      id: "topic",
      company_id: null,
      topic_id: "approvals",
      sort: "time",
      hide_opinion: true,
      min_score: 0,
    },
  ];
  const query = (key: string, data: unknown) => () => ({
    queryKey: [key],
    queryFn: async () => data,
  });
  return {
    companiesQuery: query("companies", companies),
    columnsQuery: query("columns", columns),
    topicsQuery: query("topics", [{ id: "approvals", name: "Godkendelser" }]),
    actionsQuery: query("actions", []),
    feedsQuery: query("feeds", [{ id: "other", name: "Anden kilde" }]),
    companyUpdatesQuery: (filters: unknown, hide: boolean) => ({
      queryKey: ["summaries", filters, hide],
      queryFn: async () => [
        { company_id: "empty", stories: 0, latest: null },
        { company_id: "news", stories: 1, latest: new Date().toISOString() },
      ],
    }),
    columnItemsQuery: (
      col: { company_id: string | null },
      filters: { since: string | null; feedId: string | null },
    ) => ({
      queryKey: ["column-items", col.company_id, filters],
      initialPageParam: 0,
      getNextPageParam: () => undefined,
      queryFn: async () => {
        if (fixtures.fail && col.company_id === "empty")
          throw new Error("Column could not be loaded");
        const date = new Date(Date.now() - 2 * 864e5).toISOString();
        return col.company_id === "news" &&
          !filters.feedId &&
          (!filters.since || date >= filters.since)
          ? [
              {
                id: "story",
                headline: "Vaccine contract",
                published_at: date,
                is_opinion: false,
                item_matches: [{ relevance_score: 0.9, matched_terms: [] }],
              },
            ]
          : [];
      },
    }),
  };
});
afterEach(() => {
  cleanup();
  fixtures.fail = false;
  fixtures.write.mockClear();
});
function show() {
  const Dashboard = Route.options.component as ComponentType;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Dashboard />
    </QueryClientProvider>,
  );
}
describe("only stories in saved dashboard columns", () => {
  it("hides empty companies, keeps the toggle when returning from a company, and restores without changing saved columns", async () => {
    show();
    await screen.findByText("Vaccine contract");
    expect(screen.getByRole("heading", { name: "Novonesis" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Kun med historier" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Novonesis" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Bavarian Nordic" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Godkendelser" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Virksomhed" }), {
      target: { value: "news" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tilbage til mine kolonner" }));
    expect(screen.getByRole("checkbox", { name: "Kun med historier" })).toBeChecked();
    expect(screen.queryByRole("heading", { name: "Novonesis" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Kun med historier" }));
    expect(await screen.findByRole("heading", { name: "Novonesis" })).toBeInTheDocument();
    expect(fixtures.write).not.toHaveBeenCalled();
  });
  it("recomputes empty columns when the source or date filter changes", async () => {
    show();
    await screen.findByText("Vaccine contract");
    fireEvent.click(screen.getByRole("checkbox", { name: "Kun med historier" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Kilde" }), {
      target: { value: "other" },
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Bavarian Nordic" })).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Kilde" }), { target: { value: "" } });
    await screen.findByText("Vaccine contract");
    fireEvent.change(screen.getByRole("combobox", { name: "Periode" }), { target: { value: "1" } });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Bavarian Nordic" })).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Periode" }), {
      target: { value: "30" },
    });
    expect(await screen.findByText("Vaccine contract")).toBeInTheDocument();
  });
  it("does not hide a failed query as an empty company", async () => {
    fixtures.fail = true;
    show();
    await screen.findByText(/Column could not be loaded/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Kun med historier" }));
    expect(screen.getByRole("heading", { name: "Novonesis" })).toBeInTheDocument();
    expect(screen.getByText(/Column could not be loaded/)).toBeInTheDocument();
  });
});
