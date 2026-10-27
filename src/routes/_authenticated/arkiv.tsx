import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { actionsQuery, companiesQuery, type Item } from "@/lib/queries";
import { ItemCard } from "@/components/ItemCard";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/arkiv")({
  head: () => ({ meta: [{ title: "Arkiv – Lex Nyhedsmonitor" }] }),
  component: ArchivePage,
});

type Row = Item & { item_matches: { relevance_score: number; matched_terms: string[] }[] };

// Capitalised word runs (e.g. "Fluxome Bio") in unmatched headlines = possible coverage gaps.
const STOP = new Set(["The", "A", "An", "FDA", "EMA", "EU", "Ny", "Nye", "Den", "Det", "De", "In", "On", "For", "And", "Analyse", "Testdata"]);
function candidateNames(headline: string): string[] {
  const out: string[] = [];
  const re = /\b([A-ZÆØÅ][\p{L}0-9&.-]+(?:\s+[A-ZÆØÅ][\p{L}0-9&.-]+){0,3})/gu;
  for (const m of headline.matchAll(re)) {
    const words = m[1].split(/\s+/).filter((w) => !STOP.has(w));
    if (words.length && words.join(" ").length > 2) out.push(words.join(" "));
  }
  return out;
}

function ArchivePage() {
  const [q, setQ] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(true);
  const actions = useQuery(actionsQuery());
  const companies = useQuery(companiesQuery());
  const actionMap = useMemo(() => new Map((actions.data ?? []).map((a) => [a.item_id, a])), [actions.data]);
  const items = useQuery({
    queryKey: ["archive", q],
    queryFn: async () => {
      let query = supabase.from("items").select("*, item_matches(relevance_score, matched_terms)").order("published_at", { ascending: false }).limit(300);
      if (q.trim()) query = query.ilike("headline", `%${q.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Row[];
    },
  });
  const rows = (items.data ?? []).filter((r) => !onlyUnmatched || r.item_matches.length === 0);

  const gaps = useMemo(() => {
    const known = new Set((companies.data ?? []).flatMap((c) => [c.name, ...c.aliases]).map((s) => s.toLowerCase()));
    const counts = new Map<string, number>();
    for (const r of items.data ?? []) {
      if (r.item_matches.length) continue;
      for (const n of new Set(candidateNames(r.headline))) {
        if (!known.has(n.toLowerCase())) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [items.data, companies.data]);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_280px]">
      <section>
        <h1 className="text-3xl">Arkiv</h1>
        <p className="mt-1 text-sm text-muted-foreground">Alle indsamlede nyheder, også dem uden match.</p>
        <div className="mt-4 flex items-center gap-4">
          <Input placeholder="Søg i overskrifter…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} /> Kun uden match
          </label>
        </div>
        <div className="mt-4 rounded-sm border border-border bg-card">
          {rows.map((r) => (
            <ItemCard key={r.id} item={r} score={Math.max(0, ...r.item_matches.map((m) => Number(m.relevance_score)))} terms={[...new Set(r.item_matches.flatMap((m) => m.matched_terms))]} action={actionMap.get(r.id)} />
          ))}
          {!rows.length && <div className="p-4 text-sm text-muted-foreground">Ingen nyheder.</div>}
        </div>
      </section>
      <aside>
        <h2 className="text-lg">Mulige dækningshuller</h2>
        <p className="mt-1 text-xs text-muted-foreground">Navne der går igen i nyheder uden match.</p>
        <ul className="mt-3 divide-y divide-border rounded-sm border border-border bg-card text-sm">
          {gaps.map(([n, c]) => (
            <li key={n} className="flex justify-between px-3 py-1.5">
              <button className="text-left hover:text-primary" onClick={() => setQ(n)}>{n}</button>
              <span className="font-mono text-xs text-muted-foreground">{c}</span>
            </li>
          ))}
          {!gaps.length && <li className="px-3 py-2 text-xs text-muted-foreground">Ingen endnu.</li>}
        </ul>
      </aside>
    </div>
  );
}
