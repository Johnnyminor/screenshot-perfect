/** Pure scheduling decisions. Source identities and URLs remain database rows. */
export const GOOGLE_FEEDS_PER_RUN = 6;
export function nextPollAt(intervalMinutes: number, now = Date.now()): string {
  return new Date(now + intervalMinutes * 60_000).toISOString();
}
export function isFeedStale(
  feed: { last_success_at: string | null; poll_interval_minutes?: number },
  now = Date.now(),
): boolean {
  return (
    !feed.last_success_at ||
    now - Date.parse(feed.last_success_at) > ((feed.poll_interval_minutes ?? 15) * 2 + 15) * 60_000
  );
}
export function providerCooldown(
  host: string,
  status: number,
  failures: number,
  retryAt: number | null,
  now = Date.now(),
): string {
  const base = status === 403 ? 24 * 60 : host === "news.google.com" ? 60 : 15;
  const delay = Math.min(24 * 60, base * 2 ** Math.min(Math.max(failures - 1, 0), 6)) * 60_000;
  return new Date(Math.max(now + delay, retryAt ?? 0)).toISOString();
}
export function isProviderCooling(
  health: { blocked_until: string | null } | undefined,
  now = Date.now(),
): boolean {
  return !!health?.blocked_until && Date.parse(health.blocked_until) > now;
}
