import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { topicsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/emner")({
  head: () => ({ meta: [{ title: "Emner – Lex Nyhedsmonitor" }] }),
  component: TopicsPage,
});

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function TopicsPage() {
  const qc = useQueryClient();
  const topics = useQuery(topicsQuery());
  const [name, setName] = useState("");
  const [kw, setKw] = useState("");
  const inv = () => qc.invalidateQueries({ queryKey: ["topics"] });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("topics").insert({ name, keywords: list(kw) });
      if (error) throw error;
    },
    onSuccess: () => { inv(); setName(""); setKw(""); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async (v: { id: string; keywords?: string[]; active?: boolean }) => {
      const { id, ...patch } = v;
      const { error } = await supabase.from("topics").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: inv,
  });
  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("topics").delete().eq("id", id); },
    onSuccess: inv,
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl">Emner</h1>
      <p className="mt-1 text-sm text-muted-foreground">Emnekolonner matcher nyheder på nøgleord i stedet for virksomhedsnavne.</p>
      <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Input required placeholder="Navn" value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        <Input placeholder="Nøgleord, kommasepareret" value={kw} onChange={(e) => setKw(e.target.value)} />
        <Button type="submit">Tilføj</Button>
      </form>
      <ul className="mt-6 divide-y divide-border rounded-sm border border-border bg-card">
        {(topics.data ?? []).map((t) => (
          <li key={t.id} className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="font-serif text-lg">{t.name}</span>
              <Button size="sm" variant="ghost" onClick={() => confirm("Slet emnet?") && del.mutate(t.id)}>Slet</Button>
            </div>
            <Input defaultValue={t.keywords.join(", ")} onBlur={(e) => update.mutate({ id: t.id, keywords: list(e.target.value) })} />
          </li>
        ))}
      </ul>
    </div>
  );
}
