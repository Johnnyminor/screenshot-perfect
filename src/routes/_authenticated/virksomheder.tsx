import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { companiesQuery, type Company } from "@/lib/queries";
import { lookupCvr } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/virksomheder")({
  head: () => ({ meta: [{ title: "Virksomheder – Lex Nyhedsmonitor" }] }),
  component: CompaniesPage,
});

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const empty: Partial<Company> = { name: "", aliases: [], case_sensitive_aliases: [], exclude_terms: [], sector: "pharma", is_danish: true, google_news_enabled: true, active: true };

function CompaniesPage() {
  const qc = useQueryClient();
  const companies = useQuery(companiesQuery());
  const [edit, setEdit] = useState<Partial<Company> | null>(null);
  const [q, setQ] = useState("");
  const cvrFn = useServerFn(lookupCvr);
  const [cvrHit, setCvrHit] = useState<{ cvr: string; name: string; address: string } | null>(null);

  const save = useMutation({
    mutationFn: async (c: Partial<Company>) => {
      const payload = {
        name: c.name!, aliases: c.aliases ?? [], case_sensitive_aliases: c.case_sensitive_aliases ?? [], exclude_terms: c.exclude_terms ?? [],
        ticker: c.ticker || null, cvr: c.cvr || null, country: c.country || null, sector: c.sector ?? "pharma",
        is_danish: !!c.is_danish, notes: c.notes || null, google_news_enabled: !!c.google_news_enabled, active: !!c.active,
      };
      const { error } = c.id ? await supabase.from("companies").update(payload).eq("id", c.id) : await supabase.from("companies").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["feeds"] });
      setEdit(null);
      toast.success("Gemt");
    },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["companies"] }); setEdit(null); },
  });
  const cvr = useMutation({
    mutationFn: (name: string) => cvrFn({ data: { name } }),
    onSuccess: (r) => (r.found ? setCvrHit(r) : toast.error(`CVR: ${r.message}`)),
    onError: (e) => toast.error(e.message),
  });

  const rows = (companies.data ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Virksomheder</h1>
          <p className="mt-1 text-sm text-muted-foreground">{companies.data?.length ?? 0} overvågede virksomheder. Hver aktiv virksomhed får sit eget Google News-feed.</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Søg…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Button onClick={() => { setCvrHit(null); setEdit({ ...empty }); }}>Tilføj virksomhed</Button>
        </div>
      </div>
      <table className="mt-6 w-full border border-border bg-card text-sm">
        <thead className="bg-muted text-left font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-3 py-2">Navn</th><th>Aliaser</th><th>Ticker</th><th>CVR</th><th>Land</th><th>Sektor</th><th>Status</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-muted/60" onClick={() => { setCvrHit(null); setEdit(c); }}>
              <td className="px-3 py-1.5 font-medium">{c.name}</td>
              <td className="text-xs text-muted-foreground">{[...c.aliases, ...c.case_sensitive_aliases].join(", ")}</td>
              <td className="font-mono text-xs">{c.ticker}</td>
              <td className="font-mono text-xs">{c.cvr ?? (c.is_danish ? <span className="text-muted-foreground">mangler</span> : "")}</td>
              <td className="text-xs">{c.country}</td>
              <td className="text-xs">{c.sector}</td>
              <td className="text-xs">{c.active ? "Aktiv" : "Pause"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{edit?.id ? "Redigér virksomhed" : "Ny virksomhed"}</DialogTitle></DialogHeader>
          {edit && (
            <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(edit); }}>
              <div className="col-span-2 space-y-1"><Label>Navn</Label><Input required value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="col-span-2 space-y-1"><Label>Aliaser (kommasepareret)</Label><Input value={(edit.aliases ?? []).join(", ")} onChange={(e) => setEdit({ ...edit, aliases: list(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Forkortelser (store bogstaver)</Label><Input placeholder="GN, ALK" value={(edit.case_sensitive_aliases ?? []).join(", ")} onChange={(e) => setEdit({ ...edit, case_sensitive_aliases: list(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Udelukkende ord</Label><Input placeholder="Greg Abbott" value={(edit.exclude_terms ?? []).join(", ")} onChange={(e) => setEdit({ ...edit, exclude_terms: list(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Ticker</Label><Input value={edit.ticker ?? ""} onChange={(e) => setEdit({ ...edit, ticker: e.target.value })} /></div>
              <div className="space-y-1"><Label>Land</Label><Input value={edit.country ?? ""} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>Sektor</Label>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={edit.sector ?? "pharma"} onChange={(e) => setEdit({ ...edit, sector: e.target.value })}>
                  <option value="pharma">Pharma</option><option value="medtech">Medtech</option><option value="other">Andet</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>CVR</Label>
                <div className="flex gap-1">
                  <Input value={edit.cvr ?? ""} onChange={(e) => setEdit({ ...edit, cvr: e.target.value })} />
                  <Button type="button" variant="outline" size="sm" className="h-9" disabled={!edit.name || cvr.isPending} onClick={() => cvr.mutate(edit.name!)}>Hent CVR</Button>
                </div>
              </div>
              {cvrHit && (
                <div className="col-span-2 rounded-sm border border-primary bg-accent p-3 text-sm">
                  <div>Fundet: <strong>{cvrHit.name}</strong> · CVR {cvrHit.cvr}</div>
                  <div className="text-xs text-muted-foreground">{cvrHit.address}</div>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" onClick={() => { setEdit({ ...edit, cvr: cvrHit.cvr }); setCvrHit(null); }}>Brug dette CVR</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCvrHit(null)}>Forkert virksomhed</Button>
                  </div>
                </div>
              )}
              <div className="col-span-2 space-y-1"><Label>Noter</Label><Input value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!edit.is_danish} onCheckedChange={(v) => setEdit({ ...edit, is_danish: v })} /> Dansk</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!edit.google_news_enabled} onCheckedChange={(v) => setEdit({ ...edit, google_news_enabled: v })} /> Google News</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!edit.active} onCheckedChange={(v) => setEdit({ ...edit, active: v })} /> Aktiv</label>
              <div className="col-span-2 mt-2 flex justify-between">
                {edit.id ? <Button type="button" variant="ghost" onClick={() => confirm("Slet virksomheden?") && del.mutate(edit.id!)}>Slet</Button> : <span />}
                <Button type="submit" disabled={save.isPending}>Gem</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
