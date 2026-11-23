import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { actionsQuery, companiesQuery, type Item } from "@/lib/queries";
import { ItemCard } from "@/components/ItemCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryError";
import { StoryFilters, useStoryFilters } from "@/components/StoryFilters";

export const Route = createFileRoute("/_authenticated/arkiv")({
  head: () => ({ meta: [{ title: "Arkiv – Lex Nyhedsmonitor" }] }),
  component: ArchivePage,
});

type Row = Item & { item_matches: { relevance_score: number; matched_terms: string[] }[] };

// Capitalised word runs (e.g. "Fluxome Bio") in unmatched headlines = possible coverage gaps.
const STOP = new Set([
  "The",
  "A",
  "An",
  "FDA",
  "EMA",
  "EU",
  "Ny",
  "Nye",
  "Den",
  "Det",
  "De",
  "In",
  "On",
  "For",
  "And",
  "Analyse",
  "Testdata",
]);
function candidateNames(headline: string): string[] {
  const out: string[] = [];
  const re = /\b([A-ZÆØÅ][\p{L}0-9&.-]+(?:\s+[A-ZÆØÅ][\p{L}0-9&.-]+){0,3})/gu;
  for (const m of headline.matchAll(re)) {
    const words = (m[1] ?? "").split(/\s+/).filter((w) => !STOP.has(w));
    if (words.length && words.join(" ").length > 2) out.push(words.join(" "));
  }
  return out;
}

function ArchivePage() {
  const filterState = useStoryFilters();
  const { filters } = filterState;
  const [q, setQ] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(true);
  const actions = useQuery(actionsQuery());
  const companies = useQuery(companiesQuery());
  const actionMap = useMemo(
    () => new Map((actions.data ?? []).map((a) => [a.item_id, a])),
    [actions.data],
  );
  const items = useInfiniteQuery({
    queryKey: ["archive", q, onlyUnmatched, filters],
    initialPageParam: 0,
    getNextPageParam: (last: Row[], pages) => (last.length < 50 ? undefined : pages.length * 50),
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from("items")
        .select("*, item_matches(relevance_score, matched_terms), item_sources(feed_id)")
        .eq("is_seed", false)
        .order("published_at", { ascending: false })
        .order("id")
        .range(pageParam, pageParam + 49);
      if (q.trim()) query = query.ilike("headline", `%${q.trim()}%`);
      if (onlyUnmatched) query = query.is("item_matches", null);
      if (filters.since) query = query.gte("published_at", filters.since);
      if (filters.feedId)
        query = query.eq("item_sources.feed_id", filters.feedId).not("item_sources", "is", null);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Row[];
    },
  });
  const rows = useMemo(() => items.data?.pages.flat() ?? [], [items.data]);

  const gaps = useMemo(() => {
    const known = new Set(
      (companies.data ?? []).flatMap((c) => [c.name, ...c.aliases]).map((s) => s.toLowerCase()),
    );
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.item_matches.length) continue;
      for (const n of new Set(candidateNames(r.headline))) {
        if (!known.has(n.toLowerCase())) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
  }, [rows, companies.data]);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_280px]">
      <section>
        <h1 className="text-3xl">Arkiv</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alle indsamlede nyheder, også dem uden match.
        </p>
        <StoryFilters value={filterState} />
        <QueryError
          error={items.error ?? actions.error ?? companies.error}
          retry={() => {
            void items.refetch();
            void actions.refetch();
            void companies.refetch();
          }}
        />
        <div className="mt-4 flex items-center gap-4">
          <Input
            placeholder="Søg i overskrifter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyUnmatched}
              onChange={(e) => setOnlyUnmatched(e.target.checked)}
            />{" "}
            Kun uden match
          </label>
        </div>
        <div className="mt-4 rounded-sm border border-border bg-card">
          {rows.map((r) => (
            <ItemCard
              key={r.id}
              item={r}
              score={Math.max(0, ...r.item_matches.map((m) => Number(m.relevance_score)))}
              terms={[...new Set(r.item_matches.flatMap((m) => m.matched_terms))]}
              action={actionMap.get(r.id)}
            />
          ))}
          {items.isPending && <div className="p-4 text-sm text-muted-foreground">Indlæser…</div>}
          {items.isSuccess && !rows.length && (
            <div className="p-4 text-sm text-muted-foreground">
              Ingen nyheder for de valgte filtre.
            </div>
          )}
          {items.hasNextPage && (
            <Button
              className="m-3"
              variant="outline"
              disabled={items.isFetchingNextPage}
              onClick={() => void items.fetchNextPage()}
            >
              Vis flere
            </Button>
          )}
        </div>
      </section>
      <aside>
        <h2 className="text-lg">Mulige dækningshuller</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Navne der går igen i de indlæste nyheder uden match. Indlæs flere for større dækning.
        </p>
        <ul className="mt-3 divide-y divide-border rounded-sm border border-border bg-card text-sm">
          {gaps.map(([n, c]) => (
            <li key={n} className="flex justify-between px-3 py-1.5">
              <button className="text-left hover:text-primary" onClick={() => setQ(n)}>
                {n}
              </button>
              <span className="font-mono text-xs text-muted-foreground">{c}</span>
            </li>
          ))}
          {!gaps.length && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Ingen endnu.</li>
          )}
        </ul>
      </aside>
    </div>
  );
}
