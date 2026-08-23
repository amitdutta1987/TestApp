import type {DateRange} from '@/types';

/**
 * All timestamps are stored as ISO-8601 UTC strings so they sort lexicographically
 * in SQLite. Range boundaries, though, are computed in the device's local
 * timezone — "today's sales" has to mean the shopkeeper's today.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toRange(from: Date, to: Date): DateRange {
  return {from: startOfDay(from).toISOString(), to: endOfDay(to).toISOString()};
}

export type SalesPeriod = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'ALL' | 'CUSTOM';

export const SALES_PERIOD_LABELS: Record<Exclude<SalesPeriod, 'CUSTOM'>, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  LAST_7_DAYS: 'Last 7 days',
  LAST_30_DAYS: 'Last 30 days',
  ALL: 'All time',
};

export function rangeForPeriod(period: SalesPeriod, now = new Date()): DateRange | null {
  switch (period) {
    case 'TODAY':
      return toRange(now, now);
    case 'YESTERDAY': {
      const yesterday = addDays(now, -1);
      return toRange(yesterday, yesterday);
    }
    case 'LAST_7_DAYS':
      return toRange(addDays(now, -6), now);
    case 'LAST_30_DAYS':
      return toRange(addDays(now, -29), now);
    case 'ALL':
    case 'CUSTOM':
      return null;
  }
}

export function todayRange(now = new Date()): DateRange {
  return toRange(now, now);
}

/** File-name-safe stamp, e.g. "2026-08-23_1435". */
export function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** "2026-08-23", used for grouping sales by day and for sale numbers. */
export function localDateKey(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
