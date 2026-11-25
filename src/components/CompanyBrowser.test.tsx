import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyBrowser } from "./CompanyBrowser";
import type { Company } from "@/lib/queries";

vi.mock("@/lib/queries", () => ({
  companyUpdatesQuery: (filters: unknown, hide: boolean) => ({
    queryKey: ["company-updates", filters, hide],
    queryFn: async () => [
      { company_id: "novonesis", stories: 0, latest: null },
      { company_id: "bavarian", stories: 7, latest: "2026-11-23T00:00:00Z" },
      { company_id: "alk", stories: 2, latest: "2026-11-24T00:00:00Z" },
    ],
  }),
}));
const companies = [
  { id: "novonesis", name: "Novonesis", aliases: ["Novozymes"], active: true },
  { id: "bavarian", name: "Bavarian Nordic", aliases: [], active: true },
  { id: "alk", name: "ALK-Abelló", aliases: [], active: true },
] as Company[];
afterEach(cleanup);
function show(selectedId = "") {
  const onSelect = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CompanyBrowser
        companies={companies}
        selectedId={selectedId}
        onSelect={onSelect}
        filters={{ since: null, feedId: null }}
        hideOpinion={false}
      />
    </QueryClientProvider>,
  );
  return onSelect;
}
describe("company browsing", () => {
  it("finds aliases and allows selecting a company with no collected stories", async () => {
    const select = show();
    await screen.findByRole("option", { name: "Novonesis — 0 historier" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Søg virksomhed" }), {
      target: { value: "NOVOZYMES" },
    });
    expect(screen.queryByRole("option", { name: /Bavarian/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Virksomhed" }), {
      target: { value: "novonesis" },
    });
    expect(select).toHaveBeenCalledWith("novonesis");
  });
  it("sorts by latest publication or count instead of company name", async () => {
    show();
    await screen.findByRole("option", { name: "Novonesis — 0 historier" });
    const ids = () =>
      Array.from(
        (screen.getByRole("combobox", { name: "Virksomhed" }) as HTMLSelectElement).options,
      ).map((o) => o.value);
    fireEvent.change(screen.getByRole("combobox", { name: "Sortér virksomheder" }), {
      target: { value: "latest" },
    });
    expect(ids()).toEqual(["", "alk", "bavarian", "novonesis"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sortér virksomheder" }), {
      target: { value: "count" },
    });
    expect(ids()).toEqual(["", "bavarian", "alk", "novonesis"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Kun med historier" }));
    expect(ids()).toEqual(["", "bavarian", "alk"]);
  });
  it("keeps the selected empty company when filters hide zero-count choices and offers return", async () => {
    const select = show("novonesis");
    await screen.findByText("0 historier med de valgte filtre.", { exact: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Kun med historier" }));
    expect(screen.getByRole("combobox", { name: "Virksomhed" })).toHaveValue("novonesis");
    fireEvent.click(screen.getByRole("button", { name: "Tilbage til mine kolonner" }));
    expect(select).toHaveBeenCalledWith("");
  });
});
