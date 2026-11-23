import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { da } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { feedsQuery, runsQuery, providersQuery, type Feed } from "@/lib/queries";
import { isFeedStale, isProviderCooling } from "@/lib/collection-policy";
import { runIngestNow, rematchArchive } from "@/lib/admin.functions";
import { sourceSchema, type Connector } from "@/lib/source-config";
import { CollectionStatus } from "@/components/CollectionStatus";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/kilder")({
  head: () => ({ meta: [{ title: "Kilder – Lex Nyhedsmonitor" }] }),
  component: FeedsPage,
});
const ago = (s: string | null) =>
  s ? formatDistanceToNowStrict(new Date(s), { locale: da, addSuffix: true }) : "aldrig";
const empty = {
  name: "",
  url: "",
  publisher: "",
  source_weight: 0.8,
  connector: "rss" as Connector,
};
const runStatus: Record<string, string> = {
  running: "Kører",
  completed: "Færdig",
  partial: "Delvist gennemført",
  failed: "Fejlet",
  abandoned: "Afbrudt",
};

function FeedsPage() {
  const qc = useQueryClient();
  const feeds = useQuery({ ...feedsQuery(), refetchInterval: 30_000 });
  const runs = useQuery(runsQuery());
  const providers = useQuery(providersQuery());
  const [showGN, setShowGN] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const ingest = useServerFn(runIngestNow);
  const rematch = useServerFn(rematchArchive);
  const invalidate = () => qc.invalidateQueries();
  const run = useMutation({
    mutationFn: (feedIds?: string[]) => ingest({ data: { feedIds } }),
    onSuccess: (result) => {
      const message = `${result.newCount} nye · ${result.ok} kilder hentet · ${result.failed} fejl · ${result.deferred} udskudt · ${result.rematched} historier genberegnet`;
      if (result.failed) toast.warning(message);
      else toast.success(message);
      void invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
      void invalidate();
    },
  });
  const rebuild = useMutation({
    mutationFn: () => rematch(),
    onSuccess: (result) => {
      toast.success(`${result.rematched} historier genberegnet`);
      void invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
      void invalidate();
    },
  });
  const update = useMutation({
    mutationFn: async ({ feed, patch }: { feed: Feed; patch: Partial<Feed> }) => {
      sourceSchema.parse({ ...feed, ...patch });
      const { error } = await supabase.from("feeds").update(patch).eq("id", feed.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const value = sourceSchema.parse(draft);
      // A new URL/connector must be fetched in full, even if old validators exist.
      const result = editing
        ? await supabase
            .from("feeds")
            .update({ ...value, etag: null, last_modified: null })
            .eq("id", editing)
        : await supabase.from("feeds").insert({ ...value, kind: "static" });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      setDraft(empty);
      setEditing(null);
      toast.success("Kilde gemt");
      void invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const all = feeds.data ?? [];
  const selected = all
    .filter((feed) => feed.kind !== "google_news" || showGN)
    .filter((feed) =>
      `${feed.name} ${feed.publisher} ${feed.url}`.toLowerCase().includes(search.toLowerCase()),
    );
  const busy =
    run.isPending ||
    rebuild.isPending ||
    (runs.data ?? []).some(
      (r) => r.status === "running" && +new Date(r.started_at) > Date.now() - 20 * 60_000,
    );
  const exportSources = () => {
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), sources: all }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `kilder-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <CollectionStatus />
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl">Kilder</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Direkte nyhedskilder prioriteres hvert 15. minut. API-kilder hentes normalt hver time.
              Google News er supplerende dækning: højst seks søgninger pr. kørsel, med pause ved
              udbyderfejl.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!feeds.isSuccess} onClick={exportSources}>
              Eksportér alle kilder ({all.length})
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => rebuild.mutate()}>
              Genberegn arkivets match
            </Button>
            <Button disabled={busy} onClick={() => run.mutate(undefined)}>
              {run.isPending ? "Henter…" : "Kør planlagt indsamling"}
            </Button>
          </div>
        </div>
        <QueryError
          error={feeds.error ?? runs.error ?? providers.error}
          retry={() => {
            void feeds.refetch();
            void runs.refetch();
            void providers.refetch();
          }}
        />
        <p className="text-xs text-muted-foreground">
          Virksomheder, emner og kildevægte genberegnes ved hver indsamling. Brug genberegning for
          at opdatere arkivet med det samme. Hver kørsel har et budget på 5 minutter.
        </p>
        {(providers.data ?? []).some((state) => isProviderCooling(state)) && (
          <section className="space-y-2 rounded-sm border border-amber-500 bg-card p-4 text-sm">
            <h2 className="text-lg">Udbyderpauser</h2>
            <p>
              Udbydere med blokering eller hastighedsgrænse får ro mellem forsøgene. Andre kilder
              indsamles fortsat. En udskudt kilde er ikke en vellykket indsamling.
            </p>
            {(providers.data ?? [])
              .filter((state) => isProviderCooling(state))
              .map((state) => (
                <div key={state.hostname}>
                  <strong>{state.hostname}</strong>: {state.last_error}. Næste forsøg tidligst{" "}
                  {new Date(state.blocked_until!).toLocaleString("da-DK")}.
                </div>
              ))}
          </section>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <Input
            className="max-w-md"
            aria-label="Søg kilder"
            placeholder="Søg kilde, udgiver eller URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="text-sm">
            <input type="checkbox" checked={showGN} onChange={(e) => setShowGN(e.target.checked)} />{" "}
            Vis Google News ({all.filter((f) => f.kind === "google_news").length})
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border bg-card text-left text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="p-3">Kilde / format</th>
                <th>Status / seneste succes</th>
                <th>Set / nye sidst</th>
                <th>Vægt</th>
                <th>Aktiv</th>
                <th>Handling</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {selected.map((feed) => {
                const stale = isFeedStale(feed);
                const cooling = providers.data?.find((state) => {
                  try {
                    return (
                      state.hostname === new URL(feed.url).hostname && isProviderCooling(state)
                    );
                  } catch {
                    return false;
                  }
                });
                return (
                  <tr key={feed.id} className="align-top">
                    <td className="p-3">
                      <strong>{feed.name}</strong>
                      <div className="text-xs">
                        {feed.publisher} ·{" "}
                        {feed.connector === "rss"
                          ? "RSS / Atom"
                          : feed.connector === "pubmed"
                            ? "PubMed API"
                            : "ClinicalTrials.gov API"}
                      </div>
                      <a
                        href={feed.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-sm truncate text-xs underline"
                      >
                        {feed.url}
                      </a>
                      {feed.last_error && (
                        <p className="mt-1 max-w-sm text-xs text-destructive">{feed.last_error}</p>
                      )}
                    </td>
                    <td className="py-3 text-xs">
                      <span
                        className={feed.last_error || stale ? "text-destructive" : "text-success"}
                      >
                        {!feed.active
                          ? "Pause"
                          : feed.last_error
                            ? `Fejl (${feed.consecutive_failures})`
                            : !feed.last_success_at
                              ? "Ikke kørt"
                              : stale
                                ? "Forældet"
                                : "OK"}
                      </span>
                      <div>{ago(feed.last_success_at)}</div>
                      <div className="text-muted-foreground">
                        Interval: {feed.poll_interval_minutes} min.
                      </div>
                      {cooling ? (
                        <div className="mt-1 text-amber-700">
                          Udbyderpause til{" "}
                          {new Date(cooling.blocked_until!).toLocaleString("da-DK")}
                        </div>
                      ) : (
                        feed.next_poll_at && (
                          <div className="text-muted-foreground">
                            Næste planlagte forsøg:{" "}
                            {new Date(feed.next_poll_at).toLocaleString("da-DK")}
                          </div>
                        )
                      )}
                      <div className="text-muted-foreground">
                        Forsøg: {ago(feed.last_polled_at)}
                      </div>
                    </td>
                    <td className="py-3">
                      {feed.last_items_seen} / {feed.last_items_new}
                    </td>
                    <td className="py-3">
                      <Input
                        key={`${feed.id}-${feed.source_weight}`}
                        aria-label={`Kildevægt: ${feed.name}`}
                        className="h-8 w-20"
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        defaultValue={feed.source_weight}
                        onBlur={(e) =>
                          update.mutate({ feed, patch: { source_weight: Number(e.target.value) } })
                        }
                      />
                    </td>
                    <td className="py-3">
                      <Switch
                        aria-label={`Aktivér ${feed.name}`}
                        checked={feed.active}
                        disabled={update.isPending}
                        onCheckedChange={(active) => update.mutate({ feed, patch: { active } })}
                      />
                    </td>
                    <td className="space-x-1 py-3 pr-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !feed.active}
                        onClick={() => run.mutate([feed.id])}
                      >
                        Kør
                      </Button>
                      {feed.kind !== "google_news" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(feed.id);
                            setDraft({
                              name: feed.name,
                              url: feed.url,
                              publisher: feed.publisher,
                              source_weight: feed.source_weight,
                              connector: feed.connector as Connector,
                            });
                          }}
                        >
                          Redigér
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {feeds.isPending && <p>Indlæser kilder…</p>}
        {feeds.isSuccess && !selected.length && <p>Ingen kilder for det valgte filter.</p>}
        <form
          className="space-y-3 rounded-sm border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h2 className="text-xl">{editing ? "Redigér kilde" : "Tilføj kilde"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Navn
              <Input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Udgiver
              <Input
                required
                value={draft.publisher}
                onChange={(e) => setDraft({ ...draft, publisher: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Format
              <select
                className="block w-full rounded-sm border bg-card p-2"
                value={draft.connector}
                onChange={(e) => setDraft({ ...draft, connector: e.target.value as Connector })}
              >
                <option value="rss">RSS / Atom</option>
                <option value="clinicaltrials">ClinicalTrials.gov JSON API</option>
                <option value="pubmed">PubMed API</option>
              </select>
            </label>
            <label className="text-sm">
              Kildevægt
              <Input
                type="number"
                required
                min="0"
                max="1"
                step="0.05"
                value={draft.source_weight}
                onChange={(e) => setDraft({ ...draft, source_weight: Number(e.target.value) })}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              HTTPS-adresse
              <Input
                type="url"
                required
                value={draft.url}
                placeholder={
                  draft.connector === "clinicaltrials"
                    ? "https://clinicaltrials.gov/api/v2/studies?query.spons=Genmab"
                    : "https://…"
                }
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </label>
          </div>
          <Button type="submit" disabled={save.isPending}>
            Gem kilde
          </Button>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setDraft(empty);
              }}
            >
              Annullér
            </Button>
          )}
        </form>
        <section>
          <h2 className="text-xl">Seneste kørsler</h2>
          <p className="text-xs text-muted-foreground">
            Kørsler uden afslutning i over 20 minutter overtages ved næste forsøg.
          </p>
          <ul className="mt-3 divide-y rounded-sm border bg-card">
            {(runs.data ?? []).map((r) => (
              <li key={r.id} className="p-3 text-sm">
                <div className="flex flex-wrap gap-3">
                  <time>{new Date(r.started_at).toLocaleString("da-DK")}</time>
                  <strong>{runStatus[r.status] ?? r.status}</strong>
                  <span>
                    {r.mode === "rematch"
                      ? "Genberegning"
                      : r.trigger_type === "schedule"
                        ? "Planlagt"
                        : "Manuel"}
                  </span>
                  <span>
                    {r.feeds_ok} OK · {r.feeds_failed} fejl · {r.feeds_deferred} udskudt ·{" "}
                    {r.items_new} nye
                  </span>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer">Vis kildelog</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">
                    {JSON.stringify(r.log, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
          {runs.isSuccess && !runs.data.length && (
            <p className="mt-2 text-sm">Ingen kørsler endnu.</p>
          )}
        </section>
      </div>
    </div>
  );
}
