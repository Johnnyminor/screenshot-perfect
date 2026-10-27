import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { da } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { feedsQuery, type Feed } from "@/lib/queries";
import { runIngestNow } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/kilder")({
  head: () => ({ meta: [{ title: "Kilder – Lex Nyhedsmonitor" }] }),
  component: FeedsPage,
});

const ago = (s: string | null) => (s ? formatDistanceToNowStrict(new Date(s), { locale: da, addSuffix: true }) : "aldrig");

function FeedsPage() {
  const qc = useQueryClient();
  const feeds = useQuery({ ...feedsQuery(), refetchInterval: 30_000 });
  const runs = useQuery({
    queryKey: ["runs"],
    refetchInterval: 30_000,
    queryFn: async () => (await supabase.from("ingest_runs").select("*").order("started_at", { ascending: false }).limit(8)).data ?? [],
  });
  const [showGN, setShowGN] = useState(false);
  const [nf, setNf] = useState({ name: "", url: "", publisher: "" });
  const ingest = useServerFn(runIngestNow);

  const run = useMutation({
    mutationFn: (feedIds?: string[]) => ingest({ data: { feedIds } }),
    onSuccess: (r) => {
      toast.success(`Kørsel færdig: ${r.newCount} nye, ${r.failed} fejl`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async (v: { id: string } & Partial<Feed>) => {
      const { id, ...patch } = v;
      const { error } = await supabase.from("feeds").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feeds"] }),
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("feeds").insert({ ...nf, kind: "static" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["feeds"] }); setNf({ name: "", url: "", publisher: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const all = feeds.data ?? [];
  const staticFeeds = all.filter((f) => f.kind === "static");
  const gn = all.filter((f) => f.kind === "google_news");
  const broken = all.filter((f) => f.consecutive_failures >= 5);

  const FeedRow = ({ f }: { f: Feed }) => (
    <tr className="align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{f.name}</div>
        <div className="max-w-md truncate font-mono text-[10px] text-muted-foreground">{f.url}</div>
        {f.last_error && <div className="mt-1 text-xs text-destructive">{f.last_error}</div>}
      </td>
      <td className="py-2 text-xs">
        {f.consecutive_failures >= 5 ? <span className="text-destructive">Brudt ({f.consecutive_failures})</span> : f.last_error ? <span className="text-destructive">Fejl</span> : f.last_success_at ? <span className="text-success">OK</span> : <span className="text-muted-foreground">Ikke kørt</span>}
        <div className="text-muted-foreground">{ago(f.last_polled_at)}</div>
      </td>
      <td className="py-2">
        <Input type="number" step="0.05" min="0" max="1" defaultValue={String(f.source_weight)} className="h-8 w-20" onBlur={(e) => update.mutate({ id: f.id, source_weight: Number(e.target.value) })} />
      </td>
      <td className="py-2"><Switch checked={f.active} onCheckedChange={(v) => update.mutate({ id: f.id, active: v })} /></td>
      <td className="py-2 pr-3"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate([f.id])}>Kør</Button></td>
    </tr>
  );

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl">Kilder</h1>
          <p className="mt-1 text-sm text-muted-foreground">Hentes automatisk hvert 15. minut. Kun RSS – ingen scraping.</p>
        </div>
        <Button disabled={run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending ? "Henter…" : "Kør nu (alle)"}</Button>
      </div>
      {broken.length > 0 && <div className="mt-4 rounded-sm border border-destructive p-3 text-sm text-destructive">{broken.length} kilde(r) har fejlet 5+ gange i træk.</div>}

      <table className="mt-6 w-full border border-border bg-card text-sm">
        <thead className="bg-muted text-left font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-3 py-2">Kilde</th><th>Status</th><th>Vægt</th><th>Aktiv</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-border">{staticFeeds.map((f) => <FeedRow key={f.id} f={f} />)}</tbody>
      </table>

      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Input required placeholder="Navn" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
        <Input required type="url" placeholder="RSS-URL" value={nf.url} onChange={(e) => setNf({ ...nf, url: e.target.value })} />
        <Input required placeholder="Udgiver" value={nf.publisher} onChange={(e) => setNf({ ...nf, publisher: e.target.value })} />
        <Button type="submit" variant="outline">Tilføj kilde</Button>
      </form>

      <button className="mt-8 text-sm underline" onClick={() => setShowGN(!showGN)}>
        {showGN ? "Skjul" : "Vis"} Google News-feeds ({gn.length}, ét pr. virksomhed)
      </button>
      {showGN && (
        <table className="mt-3 w-full border border-border bg-card text-sm">
          <tbody className="divide-y divide-border">{gn.map((f) => <FeedRow key={f.id} f={f} />)}</tbody>
        </table>
      )}

      <h2 className="mt-10 text-xl">Seneste kørsler</h2>
      <ul className="mt-3 divide-y divide-border rounded-sm border border-border bg-card font-mono text-xs">
        {(runs.data ?? []).map((r) => (
          <li key={r.id} className="flex gap-4 px-3 py-1.5">
            <span>{new Date(r.started_at).toLocaleString("da-DK")}</span>
            <span>{r.finished_at ? "færdig" : "kører…"}</span>
            <span className="text-success">{r.feeds_ok} ok</span>
            <span className="text-destructive">{r.feeds_failed} fejl</span>
            <span>{r.items_new} nye</span>
          </li>
        ))}
        {!runs.data?.length && <li className="px-3 py-2 text-muted-foreground">Ingen kørsler endnu.</li>}
      </ul>
    </div>
  );
}
