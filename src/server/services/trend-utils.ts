/**
 * Shared period/trend-bucket helpers for chart data — used by both the global
 * dashboard (dashboard-service.ts) and per-chat statistics
 * (chat-statistics-service.ts) so "24H means hourly buckets over the last 24
 * hours" means the same thing everywhere charts are built.
 */

export const DASHBOARD_PERIODS = ["24H", "7D", "30D"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export function periodMilliseconds(period: DashboardPeriod) {
  if (period === "24H") return 24 * 60 * 60 * 1000;
  if (period === "7D") return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function hourKey(date: Date) {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy.toISOString().replace(".000Z", "Z");
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function trendBucketKey(period: DashboardPeriod, date: Date) {
  return period === "24H" ? hourKey(date) : dayKey(date);
}

export function buildTrendSlots(period: DashboardPeriod, from: Date, now: Date) {
  const hourly = period === "24H";
  const result: Array<{ key: string; at: string; label: string }> = [];
  const cursor = new Date(from);

  if (hourly) {
    cursor.setUTCMinutes(0, 0, 0);
    while (cursor <= now) {
      const key = hourKey(cursor);
      result.push({
        key,
        at: new Date(cursor).toISOString(),
        label: new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC"
        }).format(cursor)
      });
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }
    return result.slice(-24);
  }

  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= now) {
    const key = dayKey(cursor);
    result.push({
      key,
      at: `${key}T00:00:00.000Z`,
      label: new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: period === "30D" ? "short" : "2-digit",
        timeZone: "UTC"
      }).format(cursor)
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result.slice(period === "7D" ? -7 : -30);
}
