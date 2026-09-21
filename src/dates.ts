const DAY = 86_400_000;

export function parseIsoDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Expected YYYY-MM-DD, got "${s}"`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${s}"`);
  return d;
}

export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string => toIsoDate(new Date(parseIsoDate(iso).getTime() + n * DAY));

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY);
}

/** ISO dates from `from` (inclusive) to `to` (exclusive). */
export function dateRange(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(from, i));
}
