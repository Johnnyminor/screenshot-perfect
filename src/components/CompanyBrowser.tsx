import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { companyUpdatesQuery, type Company, type StoryFilters } from "@/lib/queries";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { QueryError } from "./QueryError";

type Sort = "name" | "latest" | "count";
const storyCount = (count: number) => `${count} ${count === 1 ? "historie" : "historier"}`;
export function CompanyBrowser({
  companies,
  selectedId,
  onSelect,
  filters,
  hideOpinion,
}: {
  companies: Company[];
  selectedId: string;
  onSelect: (id: string) => void;
  filters: StoryFilters;
  hideOpinion: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [onlyUpdates, setOnlyUpdates] = useState(false);
  const updates = useQuery(companyUpdatesQuery(filters, hideOpinion));
  const byId = new Map((updates.data ?? []).map((row) => [row.company_id, row]));
  const selected = companies.find((company) => company.id === selectedId);
  const needle = search.trim().toLocaleLowerCase("da");
  const choices = companies
    .filter(
      (company) =>
        [company.name, ...company.aliases].some((name) =>
          name.toLocaleLowerCase("da").includes(needle),
        ) &&
        (!onlyUpdates || (byId.get(company.id)?.stories ?? 0) > 0),
    )
    .sort((a, b) => {
      const left = byId.get(a.id),
        right = byId.get(b.id);
      const order =
        sort === "count"
          ? (right?.stories ?? 0) - (left?.stories ?? 0)
          : sort === "latest"
            ? (right?.latest ? Date.parse(right.latest) : 0) -
              (left?.latest ? Date.parse(left.latest) : 0)
            : 0;
      return order || a.name.localeCompare(b.name, "da");
    });
  // A changed date/source filter must not silently switch the selected company.
  const pinned =
    selected && !choices.some((company) => company.id === selectedId) ? selected : null;
  const label = (company: Company) =>
    `${company.name}${!company.active ? " (pauset)" : ""} — ${updates.data ? storyCount(byId.get(company.id)?.stories ?? 0) : "antal afventer"}`;
  return (
    <section
      className="space-y-2 border-b bg-card px-4 py-3 text-sm"
      aria-label="Find virksomhedsopdateringer"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          Søg virksomhed
          <Input
            type="search"
            aria-label="Søg virksomhed"
            placeholder="Navn eller alias…"
            className="w-56"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="space-y-1">
          Virksomhed
          <select
            aria-label="Virksomhed"
            className="block h-9 max-w-full rounded-sm border bg-card px-2 sm:w-80"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">Mine faste kolonner</option>
            {pinned && <option value={pinned.id}>{label(pinned)}</option>}
            {choices.map((company) => (
              <option key={company.id} value={company.id}>
                {label(company)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          Sortér virksomheder
          <select
            aria-label="Sortér virksomheder"
            className="block h-9 rounded-sm border bg-card px-2"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            <option value="name">Navn A–Å</option>
            <option value="latest">Nyeste historie først</option>
            <option value="count">Flest historier først</option>
          </select>
        </label>
        <label className="flex h-9 items-center gap-2">
          <input
            type="checkbox"
            checked={onlyUpdates}
            disabled={!updates.data}
            onChange={(event) => setOnlyUpdates(event.target.checked)}
          />
          Kun med historier
        </label>
        {selectedId && (
          <Button variant="outline" onClick={() => onSelect("")}>
            Tilbage til mine kolonner
          </Button>
        )}
      </div>
      <QueryError error={updates.error} retry={() => void updates.refetch()} />
      <p className="text-xs text-muted-foreground">
        {choices.length} af {companies.length} virksomheder matcher søgningen. Antal følger periode,
        kilde og holdningsfilter; afviste historier og testdata er skjult. Søgningen bruger det
        indsamlede arkiv.
      </p>
      {!choices.length && (
        <p>
          Ingen virksomheder matcher filtrene. Prøv et andet navn, eller slå “Kun med historier”
          fra.
        </p>
      )}
      {selected && (
        <p role="status">
          <strong>{selected.name}</strong>:{" "}
          {updates.isPending
            ? "Henter antal…"
            : updates.error
              ? "Antal kunne ikke hentes."
              : `${storyCount(byId.get(selected.id)?.stories ?? 0)} med de valgte filtre.`}
          {byId.get(selected.id)?.latest && (
            <>
              {" "}
              Seneste publicering:{" "}
              {new Date(byId.get(selected.id)!.latest!).toLocaleDateString("da-DK")}.
            </>
          )}
          {!selected.active &&
            " Virksomheden er pauset; tidligere indsamlede historier kan stadig vises."}
        </p>
      )}
    </section>
  );
}
