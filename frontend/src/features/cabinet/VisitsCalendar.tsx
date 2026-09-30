import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PatientCaseSummary } from "@/api/types";
import type { UiLang } from "@/features/patient-home/welcome";
import { programName } from "@/features/patient-home/localize";

/*
 * Patient appointment calendar (light theme), modelled on the clinic week calendar:
 * a month grid with visit markers + a day agenda. Only the patient's own visits.
 */

const TZ = "Asia/Almaty";
const WEEKDAYS: Record<UiLang, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  kz: ["Дс", "Сс", "Ср", "Бс", "Жм", "Сн", "Жс"],
};

const CAL_COPY = {
  ru: {
    prevMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    dayVisits: (n: number) => `, приёмов: ${n}`,
    noVisits: "В этот день приёмов нет",
    allVisits: "Все приёмы",
  },
  kz: {
    prevMonth: "Алдыңғы ай",
    nextMonth: "Келесі ай",
    dayVisits: (n: number) => `, қабылдаулар: ${n}`,
    noVisits: "Бұл күні қабылдау жоқ",
    allVisits: "Барлық қабылдаулар",
  },
} as const;

function localDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function VisitsCalendar({
  cases,
  lang,
  programFallback,
  statusLabel,
}: {
  cases: PatientCaseSummary[];
  lang: UiLang;
  programFallback: string;
  statusLabel: (status: string | null) => string | null;
}) {
  const cal = CAL_COPY[lang];
  const visits = useMemo(
    () =>
      cases
        .filter((c) => c.booked_starts_at)
        .map((c) => ({ ...c, day: localDay(c.booked_starts_at!) }))
        .sort((a, b) => a.booked_starts_at!.localeCompare(b.booked_starts_at!)),
    [cases],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, typeof visits>();
    for (const v of visits) m.set(v.day, [...(m.get(v.day) ?? []), v]);
    return m;
  }, [visits]);

  const first = visits[0]?.day ?? "2026-10-01";
  const [month, setMonth] = useState(() => first.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(visits[0]?.day ?? null);

  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const offset = (start.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => {
    const d = i - offset + 1;
    return d >= 1 && d <= daysInMonth ? `${month}-${String(d).padStart(2, "0")}` : null;
  });
  const title = new Intl.DateTimeFormat(lang === "kz" ? "kk-KZ" : "ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const agenda = selected ? byDay.get(selected) ?? [] : [];
  const todayKey = localDay(new Date().toISOString());

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="rounded-2xl border border-[#03392D]/[0.09] bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[16px] font-semibold capitalize text-[#10261E]">{title}</p>
          <div className="flex gap-1">
            <button type="button" aria-label={cal.prevMonth} onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center rounded-full text-[#03392D] transition hover:bg-[#03392D]/[0.06]">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" aria-label={cal.nextMonth} onClick={() => shift(1)} className="grid h-9 w-9 place-items-center rounded-full text-[#03392D] transition hover:bg-[#03392D]/[0.06]">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-semibold uppercase tracking-[0.06em] text-[#52655B]">
          {WEEKDAYS[lang].map((w) => (
            <span key={w} className="py-1">{w}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((key, i) => {
            if (!key) return <span key={i} />;
            const items = byDay.get(key) ?? [];
            const on = key === selected;
            const pending = items.some((v) => v.appointment_status === "clinic_request_pending");
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={on}
                aria-label={`${Number(key.slice(8))}${items.length ? cal.dayVisits(items.length) : ""}`}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-[14px] tabular-nums transition ${
                  on
                    ? "bg-[#03392D] font-semibold text-white"
                    : items.length
                      ? "bg-[#8BC53F]/15 font-semibold text-[#10261E] hover:bg-[#8BC53F]/25"
                      : "text-[#18342A] hover:bg-[#03392D]/[0.05]"
                } ${key === todayKey && !on ? "ring-1 ring-[#03392D]/30" : ""}`}
              >
                {Number(key.slice(8))}
                {items.length ? (
                  <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${on ? "bg-white" : pending ? "bg-[#d98e04]" : "bg-[#5a9a1f]"}`} aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[#03392D]/[0.09] bg-white p-5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#52655B]">
          {selected
            ? new Intl.DateTimeFormat(lang === "kz" ? "kk-KZ" : "ru-RU", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" }).format(new Date(`${selected}T00:00:00Z`))
            : "—"}
        </p>
        {agenda.length === 0 ? (
          <p className="mt-3 text-[14px] text-[#52655B]">{cal.noVisits}</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {agenda.map((v) => {
              const pending = v.appointment_status === "clinic_request_pending";
              return (
                <li key={v.case_id} className={`rounded-xl border-l-4 bg-[#F4F8F5] px-3 py-2.5 ${pending ? "border-[#d98e04]" : "border-[#5a9a1f]"}`}>
                  <p className="text-[15px] font-semibold tabular-nums text-[#10261E]">{timeOf(v.booked_starts_at!)}</p>
                  <p className="truncate text-[13px] text-[#18342A]">{programName(v.selected_program_name, v.selected_program_name_kz, lang) ?? programFallback}</p>
                  <p className="text-[12px] text-[#52655B]">{statusLabel(v.appointment_status)}</p>
                </li>
              );
            })}
          </ul>
        )}
        {visits.length ? (
          <div className="mt-5 border-t border-[#03392D]/[0.07] pt-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#52655B]">{cal.allVisits}</p>
            <ul className="mt-2 grid gap-1">
              {visits.map((v) => (
                <li key={v.case_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setMonth(v.day.slice(0, 7));
                      setSelected(v.day);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition hover:bg-[#03392D]/[0.05]"
                  >
                    <span className="truncate text-[#18342A]">{programName(v.selected_program_name, v.selected_program_name_kz, lang) ?? programFallback}</span>
                    <span className="shrink-0 tabular-nums text-[#52655B]">
                      {new Intl.DateTimeFormat(lang === "kz" ? "kk-KZ" : "ru-RU", { day: "2-digit", month: "2-digit", timeZone: TZ }).format(new Date(v.booked_starts_at!))} · {timeOf(v.booked_starts_at!)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
