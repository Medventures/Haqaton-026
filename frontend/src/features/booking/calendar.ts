import { format } from "date-fns";

/** Booking window is Oct–Nov 2026. Calendar arrows are clamped to it. */
export const MONTH_MIN = new Date(2026, 9, 1); // Oct 2026
export const MONTH_MAX = new Date(2026, 10, 1); // Nov 2026

export function monthKey(d: Date): string {
  return format(d, "yyyy-MM");
}

export function addMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function monthTitle(d: Date, lang: "ru" | "kz"): string {
  const title = new Intl.DateTimeFormat(lang === "kz" ? "kk-KZ" : "ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Almaty",
  }).format(d);
  return title.charAt(0).toLocaleUpperCase(lang === "kz" ? "kk-KZ" : "ru-RU") + title.slice(1);
}

/**
 * Build a Monday-first 6-row grid of dates (as `Date | null` per cell) for the given month.
 * Leading/trailing days from neighbouring months are `null` so the grid stays clean.
 */
export function buildMonthGrid(anchor: Date): (Date | null)[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  // JS: 0=Sun … 6=Sat. Convert to Mon-first offset (0=Mon … 6=Sun).
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function isWeekend(d: Date): boolean {
  const g = d.getDay();
  return g === 0 || g === 6;
}
