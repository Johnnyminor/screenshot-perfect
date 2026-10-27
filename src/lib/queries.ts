import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Company = Database["public"]["Tables"]["companies"]["Row"];
export type Topic = Database["public"]["Tables"]["topics"]["Row"];
export type Feed = Database["public"]["Tables"]["feeds"]["Row"];
export type Item = Database["public"]["Tables"]["items"]["Row"];
export type EditorColumn = Database["public"]["Tables"]["editor_columns"]["Row"];
export type ItemAction = Database["public"]["Tables"]["item_actions"]["Row"];

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const companiesQuery = () =>
  queryOptions({ queryKey: ["companies"], queryFn: () => must(supabase.from("companies").select("*").order("name")) });
export const topicsQuery = () =>
  queryOptions({ queryKey: ["topics"], queryFn: () => must(supabase.from("topics").select("*").order("name")) });
export const feedsQuery = () =>
  queryOptions({ queryKey: ["feeds"], queryFn: () => must(supabase.from("feeds").select("*").order("kind").order("name")) });
export const columnsQuery = () =>
  queryOptions({ queryKey: ["columns"], queryFn: () => must(supabase.from("editor_columns").select("*").order("position")) });
export const actionsQuery = () =>
  queryOptions({
    queryKey: ["actions"],
    queryFn: () => must(supabase.from("item_actions").select("*")),
    refetchInterval: 60_000,
  });

export type ColumnItem = Item & { item_matches: { relevance_score: number; matched_terms: string[] }[] };

export const columnItemsQuery = (col: Pick<EditorColumn, "company_id" | "topic_id">) =>
  queryOptions({
    queryKey: ["column-items", col.company_id, col.topic_id],
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("items")
        .select("*, item_matches!inner(relevance_score, matched_terms, company_id, topic_id)")
        .order("published_at", { ascending: false })
        .limit(150);
      q = col.company_id ? q.eq("item_matches.company_id", col.company_id) : q.eq("item_matches.topic_id", col.topic_id!);
      return (await must(q)) as unknown as ColumnItem[];
    },
  });

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Ikke logget ind");
  return data.user.id;
}
