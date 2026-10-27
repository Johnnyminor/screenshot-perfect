import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { da } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { buildCitation } from "@/lib/triage";
import { currentUserId, type Item, type ItemAction } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Status = ItemAction["status"];

export function useItemActions() {
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: async (v: { itemId: string; status: Status; articleRef?: string | undefined; note?: string | undefined }) => {
      const user_id = await currentUserId();
      const { error } = await supabase.from("item_actions").upsert(
        { item_id: v.itemId, user_id, status: v.status, article_ref: v.articleRef ?? null, note: v.note ?? null, updated_at: new Date().toISOString() },
        { onConflict: "item_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["actions"] }),
    onError: (e) => toast.error(e.message),
  });
  const setOpinion = useMutation({
    mutationFn: async (v: { itemId: string; value: boolean }) => {
      const { error } = await supabase.from("items").update({ is_opinion: v.value }).eq("id", v.itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["column-items"] });
      qc.invalidateQueries({ queryKey: ["archive"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return { setStatus, setOpinion };
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 0.75 ? "bg-primary text-primary-foreground" : score >= 0.5 ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground";
  return <span className={cn("rounded-sm px-1.5 py-0.5 font-mono text-[10px] tabular-nums", tone)}>{score.toFixed(2)}</span>;
}

export function ItemCard({
  item,
  score,
  terms,
  action,
}: {
  item: Item;
  score: number;
  terms: string[];
  action?: ItemAction | undefined;
}) {
  const { setStatus, setOpinion } = useItemActions();
  const [ref, setRef] = useState(action?.article_ref ?? "");
  const status = action?.status ?? "new";
  const published = new Date(item.published_at);

  return (
    <article className={cn("group border-b border-border px-3 py-3 transition-colors hover:bg-muted/60", status !== "new" && "opacity-60")}>
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="truncate">{item.publisher}</span>
        <span>·</span>
        <time dateTime={item.published_at} title={published.toLocaleString("da-DK")}>
          {formatDistanceToNowStrict(published, { locale: da })}
          {item.published_at_estimated && " (anslået)"}
        </time>
        <span className="ml-auto"><ScoreBadge score={score} /></span>
      </div>
      <a href={item.canonical_url} target="_blank" rel="noopener noreferrer" className="block font-serif text-[15px] leading-snug text-foreground hover:text-primary">
        {status === "new" && <span className="mr-1.5 inline-block size-1.5 -translate-y-0.5 rounded-full bg-primary" />}
        {item.headline}
      </a>
      {item.summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {terms.map((t) => (
          <span key={t} className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>
        ))}
        {item.is_opinion && <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px]">Holdning/kommentar</span>}
        {status === "used" && <span className="rounded-sm bg-success px-1.5 py-0.5 text-[10px] text-success-foreground">Brugt</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 opacity-70 group-hover:opacity-100">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setStatus.mutate({ itemId: item.id, status: status === "read" ? "new" : "read" })}>
          {status === "read" ? "Ulæst" : "Læst"}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]">Brugt i artikel</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2">
            <div className="text-xs font-medium">Link til Lex-artikel</div>
            <Input placeholder="https://lex.dk/..." value={ref} onChange={(e) => setRef(e.target.value)} />
            <Button size="sm" className="w-full" onClick={() => { setStatus.mutate({ itemId: item.id, status: "used", articleRef: ref || undefined }); toast.success("Markeret som brugt"); }}>
              Gem
            </Button>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setStatus.mutate({ itemId: item.id, status: "dismissed" })}>Afvis</Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setOpinion.mutate({ itemId: item.id, value: !item.is_opinion })}>
          {item.is_opinion ? "Ikke holdning" : "Markér som holdning"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={async () => {
            await navigator.clipboard.writeText(buildCitation(item));
            toast.success("Kildehenvisning kopieret");
          }}
        >
          Kopiér kildehenvisning
        </Button>
      </div>
    </article>
  );
}
