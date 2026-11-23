import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { collectionStatsQuery, feedsQuery } from "@/lib/queries";
import { QueryError } from "./QueryError";
import { isFeedStale } from "@/lib/collection-policy";

export function CollectionStatus() {
  const stats = useQuery(collectionStatsQuery());
  const feeds = useQuery({ ...feedsQuery(), refetchInterval: 30_000 });
  const staleBefore = Date.now() - 45 * 60_000;
  const active = (feeds.data ?? []).filter((feed) => feed.active);
  const failed = active.filter((feed) => feed.last_error);
  const stale = active.filter((feed) => isFeedStale(feed));
  const scheduled = stats.data?.scheduled;
  const scheduleHealthy =
    scheduled?.status === "completed" && +new Date(scheduled.started_at) >= staleBefore;
  return (
    <div className="space-y-2 border-b bg-card px-4 py-3 text-sm">
      <QueryError
        error={stats.error ?? feeds.error}
        retry={() => {
          void stats.refetch();
          void feeds.refetch();
        }}
      />
      <div className="flex flex-wrap gap-x-6 gap-y-2" aria-live="polite">
        <span>
          Seneste afsluttede indsamling:{" "}
          <strong>
            {stats.isPending
              ? "Indlæser…"
              : stats.data?.completed?.finished_at
                ? new Date(stats.data.completed.finished_at).toLocaleString("da-DK")
                : "Ingen endnu"}
          </strong>
        </span>
        <span>
          Nye seneste døgn: <strong>{stats.data?.newToday ?? "—"}</strong>
        </span>
        <Link to="/kilder" className="underline">
          {failed.length} kilder med fejl · {stale.length} uden nylig succes · {active.length}{" "}
          aktive
        </Link>
        <span className={scheduleHealthy ? "text-success" : "text-destructive"}>
          {scheduleHealthy
            ? "Planlagt indsamling observeret inden for 45 min."
            : "Planlagt indsamling: nylig succes er ikke bekræftet"}
        </span>
        {!!stats.data?.scheduled?.feeds_deferred && (
          <span className="text-muted-foreground">
            {stats.data.scheduled.feeds_deferred} kilder udskudt; se udbyderstatus under Kilder.
          </span>
        )}
      </div>
    </div>
  );
}
