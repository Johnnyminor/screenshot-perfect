import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  columnItemsQuery,
  columnsQuery,
  companiesQuery,
  topicsQuery,
  type EditorColumn,
  type StoryFilters as Filters,
} from "@/lib/queries";
import { ItemCard } from "@/components/ItemCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CollectionStatus } from "@/components/CollectionStatus";
import { StoryFilters, useStoryFilters } from "@/components/StoryFilters";
import { QueryError } from "@/components/QueryError";
import { CompanyBrowser } from "@/components/CompanyBrowser";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/overblik")({
  head: () => ({ meta: [{ title: "Overblik – Lex Nyhedsmonitor" }] }),
  component: Dashboard,
});

function Dashboard() {
  const filters = useStoryFilters();
  const cols = useQuery(columnsQuery());
  const companies = useQuery(companiesQuery());
  const topics = useQuery(topicsQuery());
  const [companyId, setCompanyId] = useState("");
  const [onlyUpdates, setOnlyUpdates] = useState(false);
  const [previewSettings, setPreviewSettings] = useState<
    Pick<EditorColumn, "sort" | "hide_opinion" | "min_score">
  >({ sort: "time", hide_opinion: false, min_score: 0 });
  const selectedCompany = companies.data?.find((company) => company.id === companyId);
  const previewColumn: EditorColumn = {
    id: `preview-${companyId}`,
    company_id: companyId,
    topic_id: null,
    user_id: "",
    created_at: "",
    position: 0,
    ...previewSettings,
  };
  const nameOf = (c: EditorColumn) =>
    c.company_id
      ? companies.data?.find((x) => x.id === c.company_id)?.name
      : topics.data?.find((x) => x.id === c.topic_id)?.name;

  return (
    <div className="flex h-full flex-col">
      <CollectionStatus />
      <StoryFilters value={filters} />
      <CompanyBrowser
        companies={companies.data ?? []}
        selectedId={companyId}
        onSelect={setCompanyId}
        filters={filters.filters}
        hideOpinion={companyId ? previewSettings.hide_opinion : false}
        onlyUpdates={onlyUpdates}
        onOnlyUpdatesChange={setOnlyUpdates}
      />
      <QueryError
        error={cols.error ?? companies.error ?? topics.error}
        retry={() => {
          void cols.refetch();
          void companies.refetch();
          void topics.refetch();
        }}
      />
      {!companyId && cols.isLoading && (
        <div className="p-6 text-sm text-muted-foreground">Indlæser…</div>
      )}
      {!companyId && cols.isSuccess && !cols.data?.length && (
        <div className="mx-auto max-w-md p-12 text-center">
          <h1 className="text-2xl">Ingen kolonner endnu</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vælg de virksomheder og emner, du dækker.
          </p>
          <Button asChild className="mt-6">
            <Link to="/kolonner">Opsæt mine kolonner</Link>
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {selectedCompany ? (
          <Column
            key={previewColumn.id}
            col={previewColumn}
            title={selectedCompany.name}
            kind="Virksomhed · midlertidig visning"
            filters={filters.filters}
            onUpdate={(patch) => setPreviewSettings((previous) => ({ ...previous, ...patch }))}
          />
        ) : (
          (cols.data ?? []).map((c) => (
            <Column
              key={c.id}
              col={c}
              title={nameOf(c) ?? "…"}
              kind={c.company_id ? "Virksomhed" : "Emne"}
              filters={filters.filters}
              hideWhenEmpty={onlyUpdates}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Column({
  col,
  title,
  kind,
  filters,
  onUpdate,
  hideWhenEmpty = false,
}: {
  col: EditorColumn;
  title: string;
  kind: string;
  filters: Filters;
  onUpdate?: (patch: Partial<EditorColumn>) => void;
  hideWhenEmpty?: boolean;
}) {
  const qc = useQueryClient();
  const items = useInfiniteQuery(columnItemsQuery(col, filters));
  const update = useMutation({
    mutationFn: async (patch: Partial<EditorColumn>) => {
      const { error } = await supabase.from("editor_columns").update(patch).eq("id", col.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["columns"] }),
    onError: (error) => toast.error(error.message),
  });
  const changeSettings = (patch: Partial<EditorColumn>) =>
    onUpdate ? onUpdate(patch) : update.mutate(patch);

  const rows = useMemo(() => {
    const list = (items.data?.pages.flat() ?? [])
      .map((i) => ({
        item: i,
        score: Math.max(...i.item_matches.map((m) => Number(m.relevance_score))),
        terms: [...new Set(i.item_matches.flatMap((m) => m.matched_terms))],
      }))
      .filter((r) => r.item.action?.status !== "dismissed")
      .filter((r) => !(col.hide_opinion && r.item.is_opinion))
      .filter((r) => r.score >= Number(col.min_score));
    if (col.sort === "relevance")
      list.sort(
        (a, b) =>
          b.score - a.score || +new Date(b.item.published_at) - +new Date(a.item.published_at),
      );
    return list;
  }, [items.data, col.hide_opinion, col.min_score, col.sort]);
  const unread = rows.filter((r) => !r.item.action || r.item.action?.status === "new").length;

  // Hide only a confirmed empty result under this column's own filters.
  // Keep loading/error states and pagination visible; an unknown result is not empty.
  if (hideWhenEmpty && items.isSuccess && !rows.length && !items.hasNextPage) return null;

  return (
    <section
      className={`flex shrink-0 flex-col overflow-hidden rounded-sm border border-border bg-card ${onUpdate ? "w-full max-w-3xl" : "w-[360px]"}`}
    >
      <header className="border-b-2 border-ink px-3 pb-2 pt-3">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              {kind}
            </div>
            <h2 className="text-xl leading-tight">{title}</h2>
          </div>
          <span className="font-mono text-xs text-primary">{unread} ulæste vist</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <div className="flex rounded-sm border border-border">
            {(["time", "relevance"] as const).map((s) => (
              <button
                key={s}
                onClick={() => changeSettings({ sort: s })}
                className={`px-2 py-0.5 ${col.sort === s ? "bg-ink text-ink-foreground" : "text-muted-foreground"}`}
              >
                {s === "time" ? "Tid" : "Relevans"}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            <Switch
              checked={col.hide_opinion}
              onCheckedChange={(v) => changeSettings({ hide_opinion: v })}
              className="scale-75"
            />
            Skjul holdning
          </label>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <QueryError error={items.error} retry={() => items.refetch()} />
        {items.isLoading && <div className="p-3 text-xs text-muted-foreground">Indlæser…</div>}
        {items.isSuccess && !rows.length && (
          <div className="p-3 text-xs text-muted-foreground">
            Ingen nyheder for de valgte filtre.
            {onUpdate && (
              <p className="mt-2">
                {filters.since && "Prøv en længere periode. "}
                {filters.feedId && "Prøv “Alle kilder”. "}
                En tom visning betyder, at der ikke er indsamlede historier med disse filtre; den
                bekræfter ikke, at virksomheden er uden nyheder.{" "}
                <Link to="/kilder" className="underline">
                  Se kildedækning
                </Link>
                .
              </p>
            )}
          </div>
        )}
        {rows.map((r) => (
          <ItemCard
            key={r.item.id}
            item={r.item}
            score={r.score}
            terms={r.terms}
            action={r.item.action ?? undefined}
          />
        ))}
        {items.hasNextPage && (
          <Button
            className="m-3"
            variant="outline"
            disabled={items.isFetchingNextPage}
            onClick={() => void items.fetchNextPage()}
          >
            {items.isFetchingNextPage ? "Indlæser…" : "Vis flere"}
          </Button>
        )}
      </div>
    </section>
  );
}
