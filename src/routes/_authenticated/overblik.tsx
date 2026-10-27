import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  actionsQuery, columnItemsQuery, columnsQuery, companiesQuery, topicsQuery,
  type EditorColumn, type ItemAction,
} from "@/lib/queries";
import { ItemCard } from "@/components/ItemCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/overblik")({
  head: () => ({ meta: [{ title: "Overblik – Lex Nyhedsmonitor" }] }),
  component: Dashboard,
});

function Dashboard() {
  const cols = useQuery(columnsQuery());
  const companies = useQuery(companiesQuery());
  const topics = useQuery(topicsQuery());
  const actions = useQuery(actionsQuery());
  const actionMap = useMemo(() => new Map((actions.data ?? []).map((a) => [a.item_id, a])), [actions.data]);
  const nameOf = (c: EditorColumn) =>
    c.company_id ? companies.data?.find((x) => x.id === c.company_id)?.name : topics.data?.find((x) => x.id === c.topic_id)?.name;

  if (cols.isLoading) return <div className="p-6 text-sm text-muted-foreground">Indlæser…</div>;
  if (!cols.data?.length)
    return (
      <div className="mx-auto max-w-md p-12 text-center">
        <h1 className="text-2xl">Ingen kolonner endnu</h1>
        <p className="mt-2 text-sm text-muted-foreground">Vælg de virksomheder og emner, du dækker.</p>
        <Button asChild className="mt-6"><Link to="/kolonner">Opsæt mine kolonner</Link></Button>
      </div>
    );

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {cols.data.map((c) => (
        <Column key={c.id} col={c} title={nameOf(c) ?? "…"} kind={c.company_id ? "Virksomhed" : "Emne"} actionMap={actionMap} />
      ))}
    </div>
  );
}

function Column({ col, title, kind, actionMap }: { col: EditorColumn; title: string; kind: string; actionMap: Map<string, ItemAction> }) {
  const qc = useQueryClient();
  const items = useQuery(columnItemsQuery(col));
  const update = useMutation({
    mutationFn: async (patch: Partial<EditorColumn>) => {
      const { error } = await supabase.from("editor_columns").update(patch).eq("id", col.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["columns"] }),
  });

  const rows = useMemo(() => {
    const list = (items.data ?? [])
      .map((i) => ({ item: i, score: Math.max(...i.item_matches.map((m) => Number(m.relevance_score))), terms: [...new Set(i.item_matches.flatMap((m) => m.matched_terms))] }))
      .filter((r) => actionMap.get(r.item.id)?.status !== "dismissed")
      .filter((r) => !(col.hide_opinion && r.item.is_opinion))
      .filter((r) => r.score >= Number(col.min_score));
    if (col.sort === "relevance") list.sort((a, b) => b.score - a.score || +new Date(b.item.published_at) - +new Date(a.item.published_at));
    return list;
  }, [items.data, actionMap, col.hide_opinion, col.min_score, col.sort]);
  const unread = rows.filter((r) => !actionMap.has(r.item.id) || actionMap.get(r.item.id)?.status === "new").length;

  return (
    <section className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-sm border border-border bg-card">
      <header className="border-b-2 border-ink px-3 pb-2 pt-3">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{kind}</div>
            <h2 className="text-xl leading-tight">{title}</h2>
          </div>
          <span className="font-mono text-xs text-primary">{unread} nye</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <div className="flex rounded-sm border border-border">
            {(["time", "relevance"] as const).map((s) => (
              <button key={s} onClick={() => update.mutate({ sort: s })} className={`px-2 py-0.5 ${col.sort === s ? "bg-ink text-ink-foreground" : "text-muted-foreground"}`}>
                {s === "time" ? "Tid" : "Relevans"}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            <Switch checked={col.hide_opinion} onCheckedChange={(v) => update.mutate({ hide_opinion: v })} className="scale-75" />
            Skjul holdning
          </label>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.isLoading && <div className="p-3 text-xs text-muted-foreground">Indlæser…</div>}
        {!items.isLoading && !rows.length && <div className="p-3 text-xs text-muted-foreground">Ingen nyheder.</div>}
        {rows.map((r) => (
          <ItemCard key={r.item.id} item={r.item} score={r.score} terms={r.terms} action={actionMap.get(r.item.id)} />
        ))}
      </div>
    </section>
  );
}
