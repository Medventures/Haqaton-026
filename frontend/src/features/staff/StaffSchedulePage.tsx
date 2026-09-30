import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApiClientError, api } from "@/api/client";
import type { DatabaseRow } from "@/api/types";
import { useActor } from "@/app/actor";
import { StaffLayout } from "@/features/staff/StaffLayout";
import { formatTime, programLabel } from "@/features/staff/format";
import { StaffPageHeader } from "@/features/staff/dark";
import { ProgressRing } from "@/features/staff/charts";

/** Demo data sits in Oct–Nov 2026; default to the week containing this day. */
const DEFAULT_DAY = "2026-10-06";
const DAY_HEIGHT_PER_HALF_HOUR = 44; // px per 30-min row
const START_HOUR = 9;
const END_HOUR = 18;
const WEEKDAY_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

type ScheduleItem = {
  slot_id: string;
  starts_at: string;
  ends_at: string;
  availability: string;
  case_id?: string | null;
  appointment_status?: string | null;
};

type DayColumn = {
  date: string; // yyyy-MM-dd
  dow: number; // 0=Mon..4=Fri
  items: ScheduleItem[];
};

function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Monday of the week containing the given yyyy-MM-dd date. */
function mondayOf(date: string): Date {
  const parsed = parseISO(`${date}T00:00:00Z`);
  return startOfWeek(new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()), {
    weekStartsOn: 1,
  });
}

/** '5–9 октября 2026' style range for a Mon..Fri week. */
function weekRangeLabel(monday: Date): string {
  const friday = addDays(monday, 4);
  const y = friday.getFullYear();
  const mStart = monday.getMonth();
  const mEnd = friday.getMonth();
  const dStart = monday.getDate();
  const dEnd = friday.getDate();
  if (mStart === mEnd) {
    return `${dStart}–${dEnd} ${MONTHS_GEN[mEnd]} ${y}`;
  }
  return `${dStart} ${MONTHS_GEN[mStart]} – ${dEnd} ${MONTHS_GEN[mEnd]} ${y}`;
}

/** Minutes from START_HOUR:00 to the given ISO time (clamped ≥ 0). */
function minutesFromStart(iso: string): number {
  const d = parseISO(iso);
  return Math.max(0, (d.getHours() - START_HOUR) * 60 + d.getMinutes());
}

function durationMinutes(startIso: string, endIso: string): number {
  const a = parseISO(startIso).getTime();
  const b = parseISO(endIso).getTime();
  return Math.max(30, Math.round((b - a) / 60000));
}

type EventKind = "confirmed" | "pending" | "blocked";

function eventKind(item: ScheduleItem): EventKind {
  if (item.availability !== "busy") return "confirmed"; // not used for free
  if (!item.case_id) return "blocked";
  const s = item.appointment_status ?? "";
  if (s === "clinic_request_pending" || s === "pending") return "pending";
  return "confirmed";
}

export function StaffSchedulePage() {
  return (
    <StaffLayout>
      <StaffScheduleInner />
    </StaffLayout>
  );
}

function StaffScheduleInner() {
  const actor = useActor();
  const [monday, setMonday] = useState<Date>(() => mondayOf(DEFAULT_DAY));
  const [view, setView] = useState<"week" | "board">("week");
  const [columns, setColumns] = useState<DayColumn[]>([]);
  const [names, setNames] = useState<Map<string, { name: string; program: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => isoDate(addDays(monday, i))), [monday]);
  const todayIso = isoDate(new Date());

  // Fetch client names once (case_id → name/program).
  useEffect(() => {
    let cancelled = false;
    void api
      .staffDatabase()
      .then((payload) => {
        if (cancelled) return;
        const map = new Map<string, { name: string; program: string | null }>();
        payload.rows.forEach((r: DatabaseRow) => {
          map.set(r.case_id, { name: r.name, program: r.program ?? r.program_id ?? null });
        });
        setNames(map);
      })
      .catch(() => {
        /* names are best-effort; schedule still renders */
      });
    return () => {
      cancelled = true;
    };
  }, [actor.ownerSession]);

  // Fetch each Mon–Fri day of the week in parallel.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(days.map((d) => api.staffSchedule(d)))
      .then((payloads) => {
        if (cancelled) return;
        setColumns(
          payloads.map((p, i) => ({
            date: days[i],
            dow: i,
            items: [...(p.items as ScheduleItem[])].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
          })),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : "Не удалось загрузить расписание");
        setColumns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days.join(","), actor.ownerSession]);

  const stats = useMemo(() => {
    let booked = 0;
    let free = 0;
    let total = 0;
    columns.forEach((c) =>
      c.items.forEach((it) => {
        total += 1;
        if (it.availability === "busy" && it.case_id) booked += 1;
        else if (it.availability !== "busy") free += 1;
      }),
    );
    const busy = columns.reduce((n, c) => n + c.items.filter((i) => i.availability === "busy").length, 0);
    const utilisation = total > 0 ? busy / total : 0;
    return { booked, free, total, utilisation };
  }, [columns]);

  const hours = useMemo(() => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i), []);

  return (
    <div>
      <StaffPageHeader
        title="Расписание терапевта"
        subtitle={`Неделя · ${weekRangeLabel(monday)} · часовой пояс клиники.`}
        actions={
          <div className="inline-flex rounded-xl border border-white/10 bg-[#0F1412] p-0.5">
            <button
              type="button"
              onClick={() => setView("week")}
              aria-pressed={view === "week"}
              className={`h-9 rounded-lg px-3 text-[13px] font-medium transition ${
                view === "week" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
              }`}
            >
              Неделя
            </button>
            <button
              type="button"
              onClick={() => setView("board")}
              aria-pressed={view === "board"}
              className={`h-9 rounded-lg px-3 text-[13px] font-medium transition ${
                view === "board" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
              }`}
            >
              Доска
            </button>
          </div>
        }
      />

      {/* Toolbar: prev / today / next + week range */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMonday((m) => addDays(m, -7))}
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#8BC53F] transition hover:bg-white/[0.05]"
          aria-label="Предыдущая неделя"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setMonday(mondayOf(DEFAULT_DAY))}
          className="h-10 rounded-xl border border-white/10 px-4 text-[13.5px] font-medium text-[#E8EFEA] transition hover:bg-white/[0.05]"
        >
          Сегодня
        </button>
        <button
          type="button"
          onClick={() => setMonday((m) => addDays(m, 7))}
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#8BC53F] transition hover:bg-white/[0.05]"
          aria-label="Следующая неделя"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
        <span className="ml-1 text-[15px] font-medium text-[#E8EFEA]">{weekRangeLabel(monday)}</span>
      </div>

      {loading ? <p className="mt-6 text-[14px] text-[#9AABA2]">Загрузка расписания…</p> : null}
      {error ? <p className="mt-6 text-[14px] text-[#F07167]">{error}</p> : null}

      {!loading && !error ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_240px]">
          <div className="min-w-0">
            {view === "week" ? (
              <WeekGrid columns={columns} hours={hours} names={names} todayIso={todayIso} />
            ) : (
              <BoardView columns={columns} names={names} todayIso={todayIso} />
            )}
          </div>
          <SummaryStrip booked={stats.booked} free={stats.free} utilisation={stats.utilisation} />
        </div>
      ) : null}
    </div>
  );
}

function SummaryStrip({ booked, free, utilisation }: { booked: number; free: number; utilisation: number }) {
  return (
    <aside className="grid content-start gap-3">
      <div className="rounded-2xl border border-white/[0.07] bg-[#18201C] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[26px] font-semibold leading-none tabular-nums text-[#E8EFEA]">{booked}</div>
            <div className="mt-1.5 text-[12.5px] text-[#9AABA2]">записей на неделе</div>
          </div>
          <ProgressRing value={utilisation} size={58} />
        </div>
        <div className="mt-2 text-[11.5px] text-[#9AABA2]">Загрузка терапевта за неделю</div>
      </div>
      <div className="rounded-2xl border border-white/[0.07] bg-[#18201C] p-4">
        <div className="text-[26px] font-semibold leading-none tabular-nums text-[#E8EFEA]">{free}</div>
        <div className="mt-1.5 text-[12.5px] text-[#9AABA2]">свободных окон</div>
      </div>
    </aside>
  );
}

function eventBlockClasses(kind: EventKind): string {
  switch (kind) {
    case "pending":
      return "border-[#F2B84B]/40 bg-[#F2B84B]/[0.12] hover:border-[#F2B84B]/70";
    case "blocked":
      return "border-white/10 bg-white/[0.04] cursor-default";
    default:
      return "border-[#8BC53F]/40 bg-[#8BC53F]/[0.12] hover:border-[#8BC53F]/70";
  }
}

const HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 6px, transparent 6px, transparent 12px)",
};

function WeekGrid({
  columns,
  hours,
  names,
  todayIso,
}: {
  columns: DayColumn[];
  hours: number[];
  names: Map<string, { name: string; program: string | null }>;
  todayIso: string;
}) {
  const gridHeight = hours.length * 2 * DAY_HEIGHT_PER_HALF_HOUR;

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#18201C]">
      <div className="min-w-[720px]">
        {/* Header row: day names */}
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(5, 1fr)` }}>
          <div className="border-b border-r border-white/[0.06]" />
          {columns.map((c) => {
            const isToday = c.date === todayIso;
            const dt = parseISO(`${c.date}T00:00:00Z`);
            return (
              <div
                key={c.date}
                className={`border-b border-white/[0.06] px-2 py-2 text-center ${
                  isToday ? "bg-[#8BC53F]/[0.1]" : ""
                }`}
              >
                <div className={`text-[12px] font-medium ${isToday ? "text-[#B9E07F]" : "text-[#9AABA2]"}`}>
                  {WEEKDAY_SHORT[c.dow]}
                </div>
                <div className={`text-[15px] font-semibold tabular-nums ${isToday ? "text-[#B9E07F]" : "text-[#E8EFEA]"}`}>
                  {dt.getUTCDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Body: time gutter + day columns */}
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(5, 1fr)` }}>
          {/* Time gutter */}
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute left-0 right-1 -translate-y-1/2 pr-1 text-right text-[10.5px] tabular-nums text-[#9AABA2]"
                style={{ top: i * 2 * DAY_HEIGHT_PER_HALF_HOUR }}
              >
                {i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {columns.map((c) => {
            const isToday = c.date === todayIso;
            return (
              <div
                key={c.date}
                className={`relative border-l border-white/[0.06] ${isToday ? "bg-[#8BC53F]/[0.03]" : ""}`}
                style={{ height: gridHeight }}
              >
                {/* Hour gridlines */}
                {hours.map((h, i) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-white/[0.05]"
                    style={{ top: i * 2 * DAY_HEIGHT_PER_HALF_HOUR }}
                  />
                ))}
                {/* Events */}
                {c.items.map((item) => {
                  const top = (minutesFromStart(item.starts_at) / 30) * DAY_HEIGHT_PER_HALF_HOUR;
                  const height = Math.max(
                    DAY_HEIGHT_PER_HALF_HOUR - 4,
                    (durationMinutes(item.starts_at, item.ends_at) / 30) * DAY_HEIGHT_PER_HALF_HOUR - 4,
                  );
                  const free = item.availability !== "busy";
                  if (free) {
                    return (
                      <div
                        key={item.slot_id}
                        className="absolute left-1 right-1 rounded-md border border-dashed border-white/[0.12]"
                        title="Свободно"
                        style={{ top: top + 2, height }}
                      />
                    );
                  }
                  const kind = eventKind(item);
                  const client = item.case_id ? names.get(item.case_id) : undefined;
                  const timeLabel = `${formatTime(item.starts_at)}–${formatTime(item.ends_at)}`;
                  const accent = kind === "pending" ? "#F2B84B" : "#8BC53F";

                  if (kind === "blocked") {
                    return (
                      <div
                        key={item.slot_id}
                        className="absolute left-1 right-1 overflow-hidden rounded-md border border-white/10 bg-white/[0.04] px-2 py-1"
                        title="Занято"
                        style={{ top: top + 2, height, ...HATCH_STYLE }}
                      >
                        <div className="text-[10.5px] tabular-nums text-[#9AABA2]">{timeLabel}</div>
                        <div className="text-[11px] text-[#9AABA2]">Занято</div>
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={item.slot_id}
                      to={`/staff/cases/${item.case_id}`}
                      className={`absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 transition ${eventBlockClasses(
                        kind,
                      )}`}
                      style={{ top: top + 2, height }}
                      title={`${timeLabel} · ${client?.name ?? item.case_id}`}
                    >
                      <span
                        className="absolute inset-y-0 left-0 w-[3px] rounded-l-md"
                        style={{ background: accent }}
                        aria-hidden
                      />
                      <div className="pl-1.5">
                        <div className="text-[10.5px] tabular-nums text-[#E8EFEA]/80">{timeLabel}</div>
                        <div className="truncate text-[12px] font-medium text-[#E8EFEA]">
                          {client?.name ?? item.case_id}
                        </div>
                        {client?.program ? (
                          <div className="truncate text-[10.5px] text-[#9AABA2]">{programLabel(client.program)}</div>
                        ) : null}
                        {kind === "pending" ? (
                          <div className="mt-0.5 text-[10px] font-medium text-[#F2C97A]">ждёт подтверждения</div>
                        ) : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ kind }: { kind: EventKind }) {
  if (kind === "pending") {
    return (
      <span className="inline-flex items-center rounded-full bg-[#F2B84B]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#F2C97A]">
        Заявка
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[#8BC53F]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#B9E07F]">
      Подтверждена
    </span>
  );
}

function BoardView({
  columns,
  names,
  todayIso,
}: {
  columns: DayColumn[];
  names: Map<string, { name: string; program: string | null }>;
  todayIso: string;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {columns.map((c) => {
        const isToday = c.date === todayIso;
        const bookings = c.items.filter((i) => i.availability === "busy" && i.case_id);
        const freeCount = c.items.filter((i) => i.availability !== "busy").length;
        const dt = parseISO(`${c.date}T00:00:00Z`);
        return (
          <div
            key={c.date}
            className={`rounded-2xl border bg-[#18201C] p-3 ${
              isToday ? "border-[#8BC53F]/40" : "border-white/[0.07]"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className={`text-[13.5px] font-semibold ${isToday ? "text-[#B9E07F]" : "text-[#E8EFEA]"}`}>
                  {WEEKDAY_FULL[c.dow]}
                </div>
                <div className="text-[11.5px] tabular-nums text-[#9AABA2]">
                  {dt.getUTCDate()} {MONTHS_GEN[dt.getUTCMonth()]}
                </div>
              </div>
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/[0.06] px-1.5 text-[12px] font-semibold tabular-nums text-[#E8EFEA]">
                {bookings.length}
              </span>
            </div>
            <div className="grid gap-2">
              {bookings.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[12px] text-[#9AABA2]">
                  Записей нет
                </p>
              ) : (
                bookings.map((item) => {
                  const kind = eventKind(item);
                  const client = item.case_id ? names.get(item.case_id) : undefined;
                  return (
                    <Link
                      key={item.slot_id}
                      to={`/staff/cases/${item.case_id}`}
                      className={`block rounded-xl border px-3 py-2.5 transition ${eventBlockClasses(kind)}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11.5px] tabular-nums text-[#E8EFEA]/80">
                          {formatTime(item.starts_at)}–{formatTime(item.ends_at)}
                        </span>
                        <StatusPill kind={kind} />
                      </div>
                      <div className="mt-1 truncate text-[13px] font-medium text-[#E8EFEA]">
                        {client?.name ?? item.case_id}
                      </div>
                      {client?.program ? (
                        <div className="truncate text-[11px] text-[#9AABA2]">{programLabel(client.program)}</div>
                      ) : null}
                    </Link>
                  );
                })
              )}
            </div>
            <div className="mt-3 border-t border-white/[0.06] pt-2 text-[11.5px] text-[#9AABA2]">
              Свободно окон: <span className="font-medium tabular-nums text-[#E8EFEA]">{freeCount}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
