import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Company = Database["public"]["Tables"]["companies"]["Row"];
export type Topic = Database["public"]["Tables"]["topics"]["Row"];
export type Feed = Database["public"]["Tables"]["feeds"]["Row"];
export type Item = Database["public"]["Tables"]["items"]["Row"];
export type EditorColumn = Database["public"]["Tables"]["editor_columns"]["Row"];
export type ItemAction = Database["public"]["Tables"]["item_actions"]["Row"];

export async function must<T>(
  p: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const companiesQuery = () =>
  queryOptions({
    queryKey: ["companies"],
    queryFn: () => must(supabase.from("companies").select("*").order("name")),
  });
export const topicsQuery = () =>
  queryOptions({
    queryKey: ["topics"],
    queryFn: () => must(supabase.from("topics").select("*").order("name")),
  });
export const feedsQuery = () =>
  queryOptions({
    queryKey: ["feeds"],
    queryFn: () => must(supabase.from("feeds").select("*").order("kind").order("name")),
  });
export const columnsQuery = () =>
  queryOptions({
    queryKey: ["columns"],
    queryFn: () => must(supabase.from("editor_columns").select("*").order("position")),
  });
export const actionsQuery = () =>
  queryOptions({
    queryKey: ["actions"],
    queryFn: () => must(supabase.from("item_actions").select("*")),
    refetchInterval: 60_000,
  });

export type ColumnItem = Item & {
  item_matches: { relevance_score: number; matched_terms: string[] }[];
};

export type StoryFilters = { since: string | null; feedId: string | null };
export const columnItemsQuery = (col: EditorColumn, filters: StoryFilters) =>
  infiniteQueryOptions({
    queryKey: [
      "column-items",
      col.company_id,
      col.topic_id,
      col.sort,
      col.min_score,
      col.hide_opinion,
      filters,
    ],
    refetchInterval: 60_000,
    initialPageParam: 0,
    getNextPageParam: (last: ColumnItem[], pages) =>
      last.length < 50 ? undefined : pages.length * 50,
    queryFn: async ({ pageParam }) => {
      const data = await must(
        supabase.rpc("dashboard_items", {
          p_company_id: col.company_id as string,
          p_topic_id: col.topic_id as string,
          p_sort: col.sort,
          p_min_score: Number(col.min_score),
          p_hide_opinion: col.hide_opinion,
          p_since: filters.since as string,
          p_feed_id: filters.feedId as string,
          p_offset: pageParam,
          p_limit: 50,
        }),
      );
      return data as unknown as ColumnItem[];
    },
  });

export const runsQuery = () =>
  queryOptions({
    queryKey: ["runs"],
    refetchInterval: 30_000,
    queryFn: () =>
      must(
        supabase
          .from("ingest_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(20),
      ),
  });

export const collectionStatsQuery = () =>
  queryOptions({
    queryKey: ["collection-stats"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 36e5).toISOString();
      const [count, completed, scheduled] = await Promise.all([
        supabase
          .from("items")
          .select("id", { count: "exact", head: true })
          .eq("is_seed", false)
          .gte("ingested_at", since),
        must(
          supabase
            .from("ingest_runs")
            .select("*")
            .eq("mode", "ingest")
            .in("status", ["completed", "partial"])
            .order("finished_at", { ascending: false })
            .limit(1),
        ),
        must(
          supabase
            .from("ingest_runs")
            .select("*")
            .eq("mode", "ingest")
            .eq("trigger_type", "schedule")
            .order("started_at", { ascending: false })
            .limit(1),
        ),
      ]);
      if (count.error) throw new Error(count.error.message);
      return {
        newToday: count.count ?? 0,
        completed: completed[0] ?? null,
        scheduled: scheduled[0] ?? null,
      };
    },
  });

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Ikke logget ind");
  return data.user.id;
}

export const providersQuery = () =>
  queryOptions({
    queryKey: ["providers"],
    refetchInterval: 30_000,
    queryFn: () => must(supabase.from("provider_health").select("*").order("hostname")),
  });

export const currentsUsageQuery = () =>
  queryOptions({
    queryKey: ["currents-usage"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const rows = await must(
        supabase
          .from("currents_daily_usage")
          .select("*")
          .eq("day", new Date().toISOString().slice(0, 10))
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });
