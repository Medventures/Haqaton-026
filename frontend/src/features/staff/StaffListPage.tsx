import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, List, Search } from "lucide-react";
import { ApiClientError, api } from "@/api/client";
import type { StaffPatientRow } from "@/api/types";
import { useActor } from "@/app/actor";
import { StaffLayout } from "@/features/staff/StaffLayout";
import { cardDark, inputDark, StaffPageHeader } from "@/features/staff/dark";
import {
  appointmentStatusLabel,
  formatDateOnly,
  formatDateTime,
  initials,
  nextActionLabel,
  programLabel,
  stageLabel,
} from "@/features/staff/format";

const STAGE_ORDER = [
  "questionnaire_saved",
  "package_selected",
  "therapist_booking_requested",
  "therapist_booking_confirmed",
  "consultation_completed",
  "physician_plan_confirmed",
  "preparation_in_progress",
  "results_available",
  "follow_up_planned",
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#18201C] px-4 py-4">
      <div className="text-[27px] font-semibold leading-none tabular-nums text-[#E8EFEA]">{value}</div>
      <div className="mt-2 text-[12.5px] leading-tight text-[#9AABA2]">{label}</div>
    </div>
  );
}

function StageChip({ stage }: { stage: string | null }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[#8BC53F]/15 px-2.5 py-1 text-[12px] font-medium text-[#B9E07F]">
      {stageLabel(stage)}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3FA37A] to-[#8BC53F] text-[12px] font-semibold text-[#0F1412]">
      {initials(name)}
    </span>
  );
}

function PatientRow({ row }: { row: StaffPatientRow }) {
  return (
    <Link
      to={`/staff/cases/${row.case_id}`}
      className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition hover:border-white/[0.07] hover:bg-white/[0.04]"
    >
      <Avatar name={row.display_name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-[#E8EFEA]">{row.display_name}</span>
          <StageChip stage={row.stage} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-[#9AABA2]">
          <span>{programLabel(row.selected_program_id)}</span>
          {row.booked_starts_at ? (
            <span className="tabular-nums">Запись: {formatDateTime(row.booked_starts_at)}</span>
          ) : row.preferred_date ? (
            <span className="tabular-nums">Желаемая: {formatDateOnly(row.preferred_date)}</span>
          ) : null}
          {row.appointment_status ? <span>{appointmentStatusLabel(row.appointment_status)}</span> : null}
        </div>
      </div>
      <span className="hidden shrink-0 text-[12.5px] text-[#9AABA2] sm:block">{nextActionLabel(row.next_action)}</span>
    </Link>
  );
}

function Board({ rows }: { rows: StaffPatientRow[] }) {
  const columns = useMemo(() => {
    const present = STAGE_ORDER.filter((s) => rows.some((r) => r.stage === s));
    const extra = Array.from(new Set(rows.map((r) => r.stage))).filter((s) => !STAGE_ORDER.includes(s));
    return [...present, ...extra];
  }, [rows]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {columns.map((stage) => {
        const items = rows.filter((r) => r.stage === stage);
        return (
          <div key={stage} className="flex w-[264px] shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold text-[#E8EFEA]">{stageLabel(stage)}</span>
              <span className="text-[12px] tabular-nums text-[#9AABA2]">{items.length}</span>
            </div>
            <div className="grid gap-2">
              {items.map((row) => (
                <Link
                  key={row.case_id}
                  to={`/staff/cases/${row.case_id}`}
                  className={`${cardDark} px-3 py-3 transition hover:border-[#8BC53F]/40`}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={row.display_name} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#E8EFEA]">{row.display_name}</span>
                  </div>
                  <div className="mt-2 text-[12.5px] text-[#9AABA2]">{programLabel(row.selected_program_id)}</div>
                  <div className="mt-1 text-[12px] text-[#9AABA2]">{nextActionLabel(row.next_action)}</div>
                </Link>
              ))}
              {items.length === 0 ? <p className="px-1 text-[12px] text-[#9AABA2]">—</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StaffListPage() {
  return (
    <StaffLayout>
      <StaffListInner />
    </StaffLayout>
  );
}

function StaffListInner() {
  const actor = useActor();
  const [patients, setPatients] = useState<StaffPatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [view, setView] = useState<"list" | "board">("list");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .staffPatients()
      .then((payload) => {
        if (!cancelled) setPatients(payload.patients);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : "Не удалось загрузить клиентов");
        setPatients([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actor.ownerSession]);

  const stages = useMemo(() => {
    const present = new Set(patients.map((p) => p.stage).filter(Boolean));
    return STAGE_ORDER.filter((s) => present.has(s));
  }, [patients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return patients.filter((row) => {
      if (stage && row.stage !== stage) return false;
      if (q) {
        const hay = `${row.display_name} ${row.case_id} ${row.patient_id} ${programLabel(row.selected_program_id)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [patients, stage, search]);

  const kpis = useMemo(() => {
    const total = patients.length;
    const booked = patients.filter((p) => p.stage === "therapist_booking_confirmed" || p.booked_starts_at).length;
    const awaitingDoctor = patients.filter((p) => p.next_action === "create_physician_plan").length;
    const results = patients.filter((p) => p.stage === "results_available" || p.next_action === "review_results").length;
    return { total, booked, awaitingDoctor, results };
  }, [patients]);

  const roleName = actor.role === "admin" ? "администратор" : actor.role === "doctor" ? "врач" : "координатор";

  return (
    <div>
      <StaffPageHeader
        title={`${greeting()}, ${roleName}`}
        subtitle="Клиенты клиники и их этап на пути к чек-апу."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Всего клиентов" value={kpis.total} />
        <StatCard label="Записаны к терапевту" value={kpis.booked} />
        <StatCard label="Ждут действия врача" value={kpis.awaitingDoctor} />
        <StatCard label="Результаты на разборе" value={kpis.results} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AABA2]" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск клиента…"
            className={`h-11 w-full pl-9 pr-3 text-[14.5px] ${inputDark}`}
          />
        </div>
        <div className="inline-flex rounded-xl border border-white/10 bg-[#0F1412] p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={`flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13.5px] font-medium transition ${
              view === "list" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
            }`}
          >
            <List className="h-4 w-4" aria-hidden /> Список
          </button>
          <button
            type="button"
            onClick={() => setView("board")}
            aria-pressed={view === "board"}
            className={`flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13.5px] font-medium transition ${
              view === "board" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
            }`}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden /> Доска
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStage("")}
          className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
            stage === "" ? "border-[#8BC53F] bg-[#8BC53F] text-[#0F1412]" : "border-white/10 text-[#9AABA2] hover:border-white/25 hover:text-[#E8EFEA]"
          }`}
        >
          Все
        </button>
        {stages.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStage(s)}
            className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
              stage === s ? "border-[#8BC53F] bg-[#8BC53F] text-[#0F1412]" : "border-white/10 text-[#9AABA2] hover:border-white/25 hover:text-[#E8EFEA]"
            }`}
          >
            {stageLabel(s)}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {loading ? <p className="text-[14px] text-[#9AABA2]">Загрузка клиентов…</p> : null}
        {error ? <p className="text-[14px] text-[#F07167]">{error}</p> : null}
        {!loading && !error && filtered.length === 0 ? (
          <p className="text-[14px] text-[#9AABA2]">Клиенты не найдены.</p>
        ) : null}

        {!loading && !error && filtered.length > 0 ? (
          view === "list" ? (
            <div className="grid gap-1">
              {filtered.map((row) => (
                <PatientRow key={row.case_id} row={row} />
              ))}
            </div>
          ) : (
            <Board rows={filtered} />
          )
        ) : null}
      </div>
    </div>
  );
}
