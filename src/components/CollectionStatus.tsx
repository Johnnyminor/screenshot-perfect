import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { collectionStatsQuery, feedsQuery } from "@/lib/queries";
import { QueryError } from "./QueryError";
import { isFeedStale, schedulerHealth } from "@/lib/collection-policy";

export function CollectionStatus() {
  const stats = useQuery(collectionStatsQuery());
  const feeds = useQuery({ ...feedsQuery(), refetchInterval: 30_000 });
  const active = (feeds.data ?? []).filter((feed) => feed.active);
  const automatic = active.filter((feed) => feed.connector !== "currents");
  const failed = automatic.filter((feed) => feed.last_error);
  const stale = automatic.filter((feed) => isFeedStale(feed));
  const scheduled = stats.data?.scheduled;
  const schedule = schedulerHealth(scheduled);
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
          Kildedækning: {failed.length} med fejl · {stale.length} uden nylig succes /{" "}
          {automatic.length} automatiske · {active.length - automatic.length} manuelle
        </Link>
        <span className={schedule.observed ? "text-success" : "text-destructive"}>
          {schedule.observed
            ? "Tidsplan: kald observeret inden for 45 min."
            : "Tidsplan: intet kald observeret inden for 45 min."}
        </span>
        {scheduled && (
          <span className={schedule.problem ? "text-destructive" : "text-muted-foreground"}>
            Seneste planlagte kørsel:{" "}
            {schedule.overdue
              ? "overskredet forventet køretid"
              : ({
                  running: "i gang",
                  completed: "afsluttet",
                  partial: "delvist gennemført",
                  failed: "fejlet",
                  abandoned: "afbrudt",
                }[scheduled.status] ?? scheduled.status)}
            . Et tidsplankald bekræfter ikke kildedækning.
          </span>
        )}
        {!!stats.data?.scheduled?.feeds_deferred && (
          <span className="text-muted-foreground">
            {stats.data.scheduled.feeds_deferred} kilder udskudt; se udbyderstatus under Kilder.
          </span>
        )}
      </div>
    </div>
  );
}
