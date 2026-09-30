import { format } from "date-fns";
import { ru } from "date-fns/locale";

export function toDateKey(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

export function formatDayLabel(day: Date): string {
  return format(day, "d MMMM yyyy", { locale: ru });
}

export function formatSlotClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
