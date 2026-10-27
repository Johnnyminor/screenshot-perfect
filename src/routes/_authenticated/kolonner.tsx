import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { columnsQuery, companiesQuery, currentUserId, topicsQuery, type EditorColumn } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/kolonner")({
  head: () => ({ meta: [{ title: "Mine kolonner – Lex Nyhedsmonitor" }] }),
  component: ColumnsPage,
});

function ColumnsPage() {
  const qc = useQueryClient();
  const cols = useQuery(columnsQuery());
  const companies = useQuery(companiesQuery());
  const topics = useQuery(topicsQuery());
  const [filter, setFilter] = useState("");
  const inv = () => qc.invalidateQueries({ queryKey: ["columns"] });

  const add = useMutation({
    mutationFn: async (v: { company_id?: string; topic_id?: string }) => {
      const user_id = await currentUserId();
      const { error } = await supabase.from("editor_columns").insert({ ...v, user_id, position: (cols.data?.length ?? 0) });
      if (error) throw error;
    },
    onSuccess: inv,
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("editor_columns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: inv,
  });
  const move = useMutation({
    mutationFn: async ({ a, b }: { a: EditorColumn; b: EditorColumn }) => {
      await supabase.from("editor_columns").update({ position: b.position }).eq("id", a.id);
      await supabase.from("editor_columns").update({ position: a.position }).eq("id", b.id);
    },
    onSuccess: inv,
  });

  const list = cols.data ?? [];
  const used = new Set(list.map((c) => c.company_id ?? c.topic_id));
  const nameOf = (c: EditorColumn) =>
    c.company_id ? companies.data?.find((x) => x.id === c.company_id)?.name : topics.data?.find((x) => x.id === c.topic_id)?.name;
  const f = filter.toLowerCase();

  return (
    <div className="mx-auto grid max-w-5xl gap-8 p-6 md:grid-cols-2">
      <section>
        <h1 className="text-3xl">Mine kolonner</h1>
        <p className="mt-1 text-sm text-muted-foreground">Rækkefølgen her er rækkefølgen på overblikket.</p>
        <ol className="mt-4 divide-y divide-border rounded-sm border border-border bg-card">
          {list.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-6 font-mono text-xs text-muted-foreground">{i + 1}</span>
              <span className="flex-1">{nameOf(c)}</span>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">{c.company_id ? "Virksomhed" : "Emne"}</span>
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move.mutate({ a: c, b: list[i - 1]! })}>↑</Button>
              <Button size="sm" variant="ghost" disabled={i === list.length - 1} onClick={() => move.mutate({ a: c, b: list[i + 1]! })}>↓</Button>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>Fjern</Button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-4 text-sm text-muted-foreground">Ingen kolonner endnu – tilføj fra listen.</li>}
        </ol>
      </section>
      <section>
        <h2 className="text-xl">Tilføj</h2>
        <Input className="mt-3" placeholder="Søg virksomhed eller emne…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-sm border border-border bg-card">
          <div className="bg-muted px-3 py-1 font-mono text-[10px] uppercase tracking-wide">Emner</div>
          {(topics.data ?? []).filter((t) => !used.has(t.id) && t.name.toLowerCase().includes(f)).map((t) => (
            <button key={t.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => add.mutate({ topic_id: t.id })}>+ {t.name}</button>
          ))}
          <div className="bg-muted px-3 py-1 font-mono text-[10px] uppercase tracking-wide">Virksomheder</div>
          {(companies.data ?? []).filter((c) => c.active && !used.has(c.id) && c.name.toLowerCase().includes(f)).map((c) => (
            <button key={c.id} className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => add.mutate({ company_id: c.id })}>
              <span>+ {c.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{c.is_danish ? "DK" : c.country}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
