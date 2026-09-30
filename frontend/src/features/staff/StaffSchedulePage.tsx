import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApiClientError, api } from "@/api/client";
import { useActor } from "@/app/actor";
import { StaffLayout } from "@/features/staff/StaffLayout";
import { formatTime } from "@/features/staff/format";
import { cardDark, inputDark, StaffPageHeader } from "@/features/staff/dark";

const DEFAULT_DAY = "2026-10-06";

type ScheduleItem = {
  slot_id: string;
  starts_at: string;
  ends_at: string;
  availability: string;
  case_id?: string | null;
};

function shiftDay(date: string, delta: number): string {
  try {
    return format(addDays(parseISO(`${date}T00:00:00Z`), delta), "yyyy-MM-dd");
  } catch {
    return date;
  }
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
  const [date, setDate] = useState(DEFAULT_DAY);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .staffSchedule(date)
      .then((payload) => {
        if (!cancelled) setItems(payload.items);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : "Не удалось загрузить расписание");
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, actor.ownerSession]);

  const sorted = useMemo(() => [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [items]);

  const busyCount = sorted.filter((i) => i.availability === "busy").length;

  return (
    <div>
      <StaffPageHeader title="Расписание" subtitle="Слоты терапевта 09:00–18:00 · часовой пояс клиники." />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDate((d) => shiftDay(d, -1))}
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#8BC53F] transition hover:bg-white/[0.05]"
          aria-label="Предыдущий день"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || DEFAULT_DAY)}
          className={`h-10 px-3 text-[14px] tabular-nums [color-scheme:dark] ${inputDark}`}
        />
        <button
          type="button"
          onClick={() => setDate((d) => shiftDay(d, 1))}
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#8BC53F] transition hover:bg-white/[0.05]"
          aria-label="Следующий день"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
        <span className="ml-1 text-[13px] text-[#9AABA2]">
          Занято: <span className="tabular-nums">{busyCount}</span> из <span className="tabular-nums">{sorted.length}</span>
        </span>
      </div>

      <div className="mt-6">
        {loading ? <p className="text-[14px] text-[#9AABA2]">Загрузка расписания…</p> : null}
        {error ? <p className="text-[14px] text-[#F07167]">{error}</p> : null}
        {!loading && !error && sorted.length === 0 ? (
          <p className="text-[14px] text-[#9AABA2]">На выбранный день слотов нет.</p>
        ) : null}

        {!loading && !error && sorted.length > 0 ? (
          <ul className="grid gap-2">
            {sorted.map((item) => {
              const busy = item.availability === "busy";
              const hasCase = Boolean(item.case_id);
              const time = (
                <span className="w-[92px] shrink-0 tabular-nums text-[13.5px] font-medium text-[#E8EFEA]">
                  {formatTime(item.starts_at)}–{formatTime(item.ends_at)}
                </span>
              );
              if (busy && hasCase) {
                return (
                  <li key={item.slot_id}>
                    <Link
                      to={`/staff/cases/${item.case_id}`}
                      className="flex items-center gap-3 rounded-xl border border-[#8BC53F]/30 bg-[#8BC53F]/[0.1] px-4 py-3 transition hover:border-[#8BC53F]/60"
                    >
                      {time}
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#8BC53F]" aria-hidden />
                      <span className="text-[14px] font-medium text-[#E8EFEA]">Приём</span>
                      <span className="ml-auto text-[13px] text-[#9AABA2] underline-offset-2 hover:underline">{item.case_id}</span>
                    </Link>
                  </li>
                );
              }
              if (busy) {
                return (
                  <li
                    key={item.slot_id}
                    className={`${cardDark} flex items-center gap-3 px-4 py-3`}
                  >
                    {time}
                    <span className="h-2 w-2 shrink-0 rounded-full bg-white/30" aria-hidden />
                    <span className="text-[14px] text-[#9AABA2]">Занято</span>
                  </li>
                );
              }
              return (
                <li key={item.slot_id} className={`${cardDark} flex items-center gap-3 px-4 py-3`}>
                  {time}
                  <span className="h-2 w-2 shrink-0 rounded-full border border-white/25" aria-hidden />
                  <span className="text-[14px] text-[#9AABA2]">Свободно</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
