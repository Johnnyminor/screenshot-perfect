import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { feedsQuery } from "@/lib/queries";

export function useStoryFilters() {
  const [days, setDays] = useState("7");
  const [feedId, setFeedId] = useState("");
  // Anchor the range to a calendar day, keeping pagination stable during refetches.
  const day = new Date().toISOString().slice(0, 10);
  const since = useMemo(
    () => (days ? new Date(Date.parse(day) - Number(days) * 864e5).toISOString() : null),
    [day, days],
  );
  return { days, setDays, feedId, setFeedId, filters: { since, feedId: feedId || null } };
}

export function StoryFilters({ value }: { value: ReturnType<typeof useStoryFilters> }) {
  const feeds = useQuery(feedsQuery());
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <label>
        Periode{" "}
        <select
          aria-label="Periode"
          className="ml-2 rounded-sm border bg-card p-2"
          value={value.days}
          onChange={(e) => value.setDays(e.target.value)}
        >
          <option value="1">Fra i går</option>
          <option value="7">Seneste uge</option>
          <option value="30">Seneste måned</option>
          <option value="">Hele arkivet</option>
        </select>
      </label>
      <label>
        Kilde{" "}
        <select
          aria-label="Kilde"
          className="ml-2 max-w-72 rounded-sm border bg-card p-2"
          value={value.feedId}
          onChange={(e) => value.setFeedId(e.target.value)}
        >
          <option value="">Alle kilder</option>
          {(feeds.data ?? []).map((feed) => (
            <option key={feed.id} value={feed.id}>
              {feed.name}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-muted-foreground">
        Kun indsamlede data. Testhistorier er skjult.
      </span>
    </div>
  );
}
