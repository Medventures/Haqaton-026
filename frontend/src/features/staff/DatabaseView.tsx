import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  Table as TableIcon,
} from "lucide-react";
import { ApiClientError, api } from "@/api/client";
import type { DatabaseRow } from "@/api/types";
import { useActor } from "@/app/actor";
import { StaffPageHeader } from "@/features/staff/dark";
import {
  appointmentStatusLabel,
  formatDateOnly,
  formatDateTime,
  formatPrice,
  initials,
  languageLabel,
  nextActionLabel,
  programLabel,
  recommendationLabel,
  sexLabel,
  stageIndex,
  stageLabel,
  STAGE_SEQUENCE,
  stageTone,
} from "@/features/staff/format";

const PAGE_SIZE = 25;

/* ---------- column model ---------- */

type ColumnKey =
  | "index"
  | "client"
  | "phone"
  | "age"
  | "sex"
  | "goal"
  | "program"
  | "price"
  | "recommended"
  | "factors"
  | "stage"
  | "preferred_date"
  | "appointment"
  | "appointment_status"
  | "next_action"
  | "language"
  | "created_at";

type ColumnDef = {
  key: ColumnKey;
  label: string;
  medical?: boolean;
  sortable?: boolean;
  numeric?: boolean;
  toggleable?: boolean;
};

const COLUMNS: ColumnDef[] = [
  { key: "index", label: "№" },
  { key: "client", label: "Клиент", sortable: true, toggleable: false },
  { key: "phone", label: "Телефон", sortable: true },
  { key: "age", label: "Возраст", medical: true, sortable: true, numeric: true },
  { key: "sex", label: "Пол", medical: true, sortable: true },
  { key: "goal", label: "Цель", medical: true, sortable: true },
  { key: "program", label: "Программа", sortable: true },
  { key: "price", label: "Стоимость", sortable: true, numeric: true },
  { key: "recommended", label: "Рекомендация", medical: true, sortable: true },
  { key: "factors", label: "Факторы", medical: true },
  { key: "stage", label: "Этап", sortable: true },
  { key: "preferred_date", label: "Желаемая дата", sortable: true },
  { key: "appointment", label: "Запись", sortable: true },
  { key: "appointment_status", label: "Статус записи", sortable: true },
  { key: "next_action", label: "Следующий шаг", sortable: true },
  { key: "language", label: "Язык", sortable: true },
  { key: "created_at", label: "Создана", sortable: true },
];

/* ---------- sort helpers ---------- */

type SortState = { key: ColumnKey; dir: "asc" | "desc" } | null;

function sortValue(row: DatabaseRow, key: ColumnKey, index: number): string | number {
  switch (key) {
    case "index":
      return index;
    case "client":
      return row.name?.toLowerCase() ?? "";
    case "phone":
      return row.phone ?? "";
    case "age":
      return row.age ?? -1;
    case "sex":
      return row.sex ?? "";
    case "goal":
      return row.goal ?? "";
    case "program":
      return programLabel(row.program_id).toLowerCase();
    case "price":
      return row.price ?? -1;
    case "recommended":
      return row.recommended ?? "";
    case "stage":
      return stageIndex(row.stage);
    case "preferred_date":
      return row.preferred_date ?? "";
    case "appointment":
      return row.appointment_at ?? "";
    case "appointment_status":
      return appointmentStatusLabel(row.appointment_status);
    case "next_action":
      return nextActionLabel(row.next_action);
    case "language":
      return row.language ?? "";
    case "created_at":
      return row.created_at ?? "";
    default:
      return "";
  }
}

/* ---------- CSV export ---------- */

function exportCsv(rows: DatabaseRow[], columns: ColumnDef[]) {
  const cols = columns.filter((c) => c.key !== "index");
  const header = ["№", ...cols.map((c) => c.label)];
  const lines = rows.map((row, i) => {
    const cells: (string | number)[] = [i + 1];
    for (const c of cols) {
      cells.push(csvCell(row, c.key));
    }
    return cells.map(csvEscape).join(";");
  });
  const content = "\uFEFF" + [header.join(";"), ...lines].join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `baza-dannyh-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(row: DatabaseRow, key: ColumnKey): string | number {
  switch (key) {
    case "client":
      return `${row.name} (${row.case_id})`;
    case "phone":
      return row.phone ?? "";
    case "age":
      return row.age ?? "";
    case "sex":
      return sexLabel(row.sex);
    case "goal":
      return row.goal ?? "";
    case "program":
      return programLabel(row.program_id);
    case "price":
      return row.price ?? "";
    case "recommended":
      return row.recommended ? recommendationLabel(row.recommended) : "";
    case "factors":
      return (row.factors ?? []).join(", ");
    case "stage":
      return stageLabel(row.stage);
    case "preferred_date":
      return row.preferred_date ? formatDateOnly(row.preferred_date) : "";
    case "appointment":
      return row.appointment_at ? formatDateTime(row.appointment_at) : "";
    case "appointment_status":
      return row.appointment_status ? appointmentStatusLabel(row.appointment_status) : "";
    case "next_action":
      return nextActionLabel(row.next_action);
    case "language":
      return languageLabel(row.language);
    case "created_at":
      return row.created_at ? formatDateTime(row.created_at) : "";
    default:
      return "";
  }
}

function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* ---------- small UI atoms ---------- */

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3FA37A] to-[#8BC53F] text-[11px] font-semibold text-[#0F1412]">
      {initials(name)}
    </span>
  );
}

function Chip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#18201C] px-3 py-1.5 text-[12.5px] text-[#9AABA2]">
      <span className="font-semibold tabular-nums text-[#E8EFEA]">{value}</span>
      {label}
    </span>
  );
}

function StagePill({ stage }: { stage: string | null }) {
  const tone = stageTone(stage);
  const idx = stageIndex(stage);
  return (
    <div className="flex min-w-[128px] flex-col gap-1">
      <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${tone.bg} ${tone.text}`}>
        {stageLabel(stage)}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${(idx / STAGE_SEQUENCE.length) * 100}%` }} />
      </span>
    </div>
  );
}

function RecPill({ tier }: { tier: "optimal" | "maximum" | null }) {
  const cls =
    tier === "maximum"
      ? "bg-[#8BC53F]/15 text-[#B9E07F]"
      : tier === "optimal"
        ? "bg-[#3FA37A]/15 text-[#7FD3B0]"
        : "bg-white/[0.06] text-[#C4D0C8]";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${cls}`}>{recommendationLabel(tier)}</span>;
}

function Factors({ factors }: { factors: string[] }) {
  if (!factors.length) return <span className="text-[#5f716a]">—</span>;
  const shown = factors.slice(0, 2);
  const rest = factors.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((f) => (
        <span key={f} className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11.5px] text-[#C4D0C8]">
          {f}
        </span>
      ))}
      {rest > 0 ? <span className="text-[11.5px] tabular-nums text-[#9AABA2]">+{rest}</span> : null}
    </div>
  );
}

/** Dropdown wrapper closing on outside click. */
function Dropdown({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-[#0F1412] px-3 text-[13.5px] font-medium text-[#C4D0C8] transition hover:border-white/25 hover:text-[#E8EFEA]"
      >
        {icon}
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-[220px] rounded-2xl border border-white/10 bg-[#18201C] p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.45)]">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- board (secondary view) ---------- */

function Board({ rows, onOpen }: { rows: DatabaseRow[]; onOpen: (id: string) => void }) {
  const columns = useMemo(() => {
    const present = STAGE_SEQUENCE.filter((s) => rows.some((r) => r.stage === s));
    const extra = Array.from(new Set(rows.map((r) => r.stage))).filter((s) => !STAGE_SEQUENCE.includes(s as (typeof STAGE_SEQUENCE)[number]));
    return [...present, ...extra];
  }, [rows]);
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {columns.map((stage) => {
        const items = rows.filter((r) => r.stage === stage);
        return (
          <div key={stage} className="flex w-[272px] shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold text-[#E8EFEA]">{stageLabel(stage)}</span>
              <span className="text-[12px] tabular-nums text-[#9AABA2]">{items.length}</span>
            </div>
            <div className="grid gap-2">
              {items.map((row) => (
                <button
                  key={row.case_id}
                  type="button"
                  onClick={() => onOpen(row.case_id)}
                  className="rounded-2xl border border-white/[0.07] bg-[#18201C] px-3 py-3 text-left transition hover:border-[#8BC53F]/40"
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={row.name} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#E8EFEA]">{row.name}</span>
                  </div>
                  <div className="mt-2 text-[12.5px] text-[#9AABA2]">{programLabel(row.program_id)}</div>
                  <div className="mt-1 flex items-center justify-between text-[12px] text-[#9AABA2]">
                    <span>{nextActionLabel(row.next_action)}</span>
                    <span className="tabular-nums text-[#C4D0C8]">{formatPrice(row.price)}</span>
                  </div>
                </button>
              ))}
              {items.length === 0 ? <p className="px-1 text-[12px] text-[#5f716a]">—</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- main ---------- */

export function DatabaseView() {
  const actor = useActor();
  const navigate = useNavigate();
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [medical, setMedical] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [fStage, setFStage] = useState("");
  const [fProgram, setFProgram] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"table" | "board">("table");
  const [hidden, setHidden] = useState<Set<ColumnKey>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .staffDatabase()
      .then((payload) => {
        if (cancelled) return;
        setRows(payload.rows);
        setMedical(payload.medical_columns);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : "Не удалось загрузить базу данных");
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actor.ownerSession]);

  // Visible columns = respect medical flag + user toggles.
  const columns = useMemo(
    () => COLUMNS.filter((c) => (c.medical ? medical : true)).filter((c) => !hidden.has(c.key)),
    [medical, hidden],
  );

  const stageOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.stage).filter(Boolean));
    const ordered = STAGE_SEQUENCE.filter((s) => present.has(s));
    const extra = Array.from(present).filter((s) => !STAGE_SEQUENCE.includes(s as (typeof STAGE_SEQUENCE)[number]));
    return [...ordered, ...extra];
  }, [rows]);

  const programOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.program_id) map.set(r.program_id, programLabel(r.program_id));
    }
    return Array.from(map.entries());
  }, [rows]);

  const statusOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.appointment_status).filter(Boolean) as string[]);
    return Array.from(present);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (fStage && row.stage !== fStage) return false;
      if (fProgram && row.program_id !== fProgram) return false;
      if (fStatus && row.appointment_status !== fStatus) return false;
      if (q) {
        const hay = `${row.name} ${row.phone ?? ""} ${row.case_id} ${row.patient_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, fStage, fProgram, fStatus]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const arr = filtered.map((r, i) => ({ r, i }));
    arr.sort((a, b) => {
      const va = sortValue(a.r, sort.key, a.i);
      const vb = sortValue(b.r, sort.key, b.i);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr.map((x) => x.r);
  }, [filtered, sort]);

  // reset page on filter/sort change
  useEffect(() => {
    setPage(0);
  }, [search, fStage, fProgram, fStatus, sort, view]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => sorted.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [sorted, clampedPage],
  );

  const summary = useMemo(() => {
    const booked = filtered.filter((r) => r.appointment_at || r.stage === "therapist_booking_confirmed").length;
    const awaitingDoctor = filtered.filter((r) => r.next_action === "create_physician_plan").length;
    const sum = filtered.reduce((acc, r) => acc + (r.price ?? 0), 0);
    return { total: filtered.length, booked, awaitingDoctor, sum };
  }, [filtered]);

  const toggleSort = (key: ColumnKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const toggleColumn = (key: ColumnKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filtersActive = Boolean(fStage || fProgram || fStatus);

  return (
    <div>
      <StaffPageHeader
        title="База данных"
        subtitle={`${sorted.length} ${plural(sorted.length, "заявка", "заявки", "заявок")}`}
        actions={
          <button
            type="button"
            onClick={() => exportCsv(sorted, columns)}
            className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-[#0F1412] px-3.5 text-[13.5px] font-medium text-[#C4D0C8] transition hover:border-[#8BC53F]/40 hover:text-[#E8EFEA]"
          >
            <Download className="h-4 w-4" aria-hidden /> Выгрузить
          </button>
        }
      />

      {/* summary chips */}
      <div className="flex flex-wrap gap-2">
        <Chip label="всего" value={summary.total} />
        <Chip label="записаны" value={summary.booked} />
        <Chip label="ждут врача" value={summary.awaitingDoctor} />
        <Chip label="₸ по выбранным программам" value={formatPrice(summary.sum)} />
      </div>

      {/* toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AABA2]" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени, телефону, ID…"
            className="h-10 w-full rounded-xl border border-white/10 bg-[#0F1412] pl-9 pr-3 text-[14px] text-[#E8EFEA] outline-none transition placeholder:text-[#9AABA2] focus:border-[#8BC53F] focus:ring-2 focus:ring-[#8BC53F]/40"
          />
        </div>

        <Dropdown label={fStage ? stageLabel(fStage) : "Этап"} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />}>
          {(close) => (
            <FilterList
              current={fStage}
              allLabel="Все этапы"
              options={stageOptions.map((s) => ({ value: s, label: stageLabel(s) }))}
              onPick={(v) => {
                setFStage(v);
                close();
              }}
            />
          )}
        </Dropdown>

        <Dropdown label={fProgram ? programLabel(fProgram) : "Программа"} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />}>
          {(close) => (
            <FilterList
              current={fProgram}
              allLabel="Все программы"
              options={programOptions.map(([value, label]) => ({ value, label }))}
              onPick={(v) => {
                setFProgram(v);
                close();
              }}
            />
          )}
        </Dropdown>

        <Dropdown label={fStatus ? appointmentStatusLabel(fStatus) : "Статус записи"} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />}>
          {(close) => (
            <FilterList
              current={fStatus}
              allLabel="Любой статус"
              options={statusOptions.map((s) => ({ value: s, label: appointmentStatusLabel(s) }))}
              onPick={(v) => {
                setFStatus(v);
                close();
              }}
            />
          )}
        </Dropdown>

        <Dropdown label="Столбцы" icon={<Columns3 className="h-4 w-4" aria-hidden />}>
          {() => (
            <div className="grid gap-0.5">
              {COLUMNS.filter((c) => c.toggleable !== false && c.key !== "index").filter((c) => (c.medical ? medical : true)).map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-[#E8EFEA] transition hover:bg-white/[0.06]"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() => toggleColumn(c.key)}
                    className="h-4 w-4 accent-[#8BC53F]"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </Dropdown>

        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setFStage("");
              setFProgram("");
              setFStatus("");
            }}
            className="h-10 rounded-xl px-3 text-[13.5px] font-medium text-[#9AABA2] transition hover:text-[#E8EFEA]"
          >
            Сбросить
          </button>
        ) : null}

        <div className="ml-auto inline-flex rounded-xl border border-white/10 bg-[#0F1412] p-0.5">
          <button
            type="button"
            onClick={() => setView("table")}
            aria-pressed={view === "table"}
            className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition ${
              view === "table" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
            }`}
          >
            <TableIcon className="h-4 w-4" aria-hidden /> Таблица
          </button>
          <button
            type="button"
            onClick={() => setView("board")}
            aria-pressed={view === "board"}
            className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition ${
              view === "board" ? "bg-white/[0.06] text-[#E8EFEA]" : "text-[#9AABA2] hover:text-[#E8EFEA]"
            }`}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden /> Доска
          </button>
        </div>
      </div>

      {/* content */}
      <div className="mt-5">
        {error ? <p className="text-[14px] text-[#F07167]">{error}</p> : null}

        {view === "board" && !loading && !error ? (
          <Board rows={sorted} onOpen={(id) => navigate(`/staff/cases/${id}`)} />
        ) : null}

        {view === "table" ? (
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#18201C]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px] tabular-nums">
                <thead>
                  <tr className="border-b border-white/[0.07] bg-[#131A17]">
                    {columns.map((c, ci) => (
                      <Th
                        key={c.key}
                        col={c}
                        sort={sort}
                        onSort={toggleSort}
                        sticky={stickyClass(ci)}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} columns={columns} />)
                    : pageRows.map((row, i) => (
                        <tr
                          key={row.case_id}
                          onClick={() => navigate(`/staff/cases/${row.case_id}`)}
                          className="group cursor-pointer border-b border-white/[0.04] odd:bg-white/[0.012] hover:bg-white/[0.05]"
                        >
                          {columns.map((c, ci) => (
                            <Td key={c.key} col={c} sticky={stickyClass(ci)}>
                              {renderCell(row, c.key, clampedPage * PAGE_SIZE + i + 1)}
                            </Td>
                          ))}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {!loading && pageRows.length === 0 ? (
              <div className="px-4 py-12 text-center text-[14px] text-[#9AABA2]">Заявки не найдены.</div>
            ) : null}
          </div>
        ) : null}

        {/* pagination */}
        {view === "table" && !loading && sorted.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-[#9AABA2] tabular-nums">
              {clampedPage * PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * PAGE_SIZE, sorted.length)} из {sorted.length}
            </span>
            <div className="flex items-center gap-1.5">
              <PageBtn disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </PageBtn>
              <span className="px-2 text-[13px] tabular-nums text-[#C4D0C8]">
                {clampedPage + 1} / {pageCount}
              </span>
              <PageBtn disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </PageBtn>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- table cell rendering ---------- */

function renderCell(row: DatabaseRow, key: ColumnKey, index: number): ReactNode {
  switch (key) {
    case "index":
      return <span className="text-[#9AABA2]">{index}</span>;
    case "client":
      return (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.name} />
          <div className="min-w-0">
            <div className="truncate font-medium text-[#E8EFEA]">{row.name}</div>
            <div className="truncate text-[11.5px] text-[#5f716a]">{row.case_id}</div>
          </div>
        </div>
      );
    case "phone":
      return <span className="text-[#C4D0C8]">{row.phone ?? "—"}</span>;
    case "age":
      return <span className="text-[#C4D0C8]">{row.age ?? "—"}</span>;
    case "sex":
      return <span className="text-[#C4D0C8]">{sexLabel(row.sex)}</span>;
    case "goal":
      return <span className="text-[#C4D0C8]">{row.goal?.trim() ? row.goal : "—"}</span>;
    case "program":
      return <span className="text-[#E8EFEA]">{programLabel(row.program_id)}</span>;
    case "price":
      return <span className="font-medium text-[#E8EFEA]">{formatPrice(row.price)}</span>;
    case "recommended":
      return <RecPill tier={row.recommended ?? null} />;
    case "factors":
      return <Factors factors={row.factors ?? []} />;
    case "stage":
      return <StagePill stage={row.stage} />;
    case "preferred_date":
      return <span className="text-[#C4D0C8]">{row.preferred_date ? formatDateOnly(row.preferred_date) : "—"}</span>;
    case "appointment":
      return <span className="text-[#C4D0C8]">{row.appointment_at ? formatDateTime(row.appointment_at) : "—"}</span>;
    case "appointment_status":
      return <span className="text-[#C4D0C8]">{row.appointment_status ? appointmentStatusLabel(row.appointment_status) : "—"}</span>;
    case "next_action":
      return <span className="text-[#C4D0C8]">{nextActionLabel(row.next_action)}</span>;
    case "language":
      return <span className="text-[#C4D0C8]">{languageLabel(row.language)}</span>;
    case "created_at":
      return <span className="text-[#9AABA2]">{row.created_at ? formatDateTime(row.created_at) : "—"}</span>;
    default:
      return null;
  }
}

/* ---------- table primitives ---------- */

function stickyClass(ci: number): string {
  // Sticky first two logical columns: № and Клиент when present.
  if (ci === 0) return "sticky left-0 z-20";
  if (ci === 1) return "sticky left-[52px] z-20";
  return "";
}

function Th({
  col,
  sort,
  onSort,
  sticky,
}: {
  col: ColumnDef;
  sort: SortState;
  onSort: (key: ColumnKey) => void;
  sticky: string;
}) {
  const active = sort?.key === col.key;
  const align = col.numeric ? "text-right" : "text-left";
  const base = `whitespace-nowrap px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-[#9AABA2] ${align} ${sticky} bg-[#131A17]`;
  if (!col.sortable) {
    return <th className={base} scope="col">{col.label}</th>;
  }
  return (
    <th className={base} scope="col">
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className={`inline-flex items-center gap-1 transition hover:text-[#E8EFEA] ${col.numeric ? "flex-row-reverse" : ""} ${active ? "text-[#E8EFEA]" : ""}`}
      >
        {col.label}
        {active ? (
          sort?.dir === "asc" ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}

function Td({ col, sticky, children }: { col: ColumnDef; sticky: string; children: ReactNode }) {
  const align = col.numeric ? "text-right" : "text-left";
  const stickyBg = sticky ? "bg-[#18201C] group-odd:bg-[#191F1C] group-hover:bg-[#1d2621]" : "";
  return <td className={`whitespace-nowrap px-3 py-2.5 ${align} ${sticky} ${stickyBg}`}>{children}</td>;
}

function SkeletonRow({ columns }: { columns: ColumnDef[] }) {
  return (
    <tr className="border-b border-white/[0.04]">
      {columns.map((c) => (
        <td key={c.key} className="px-3 py-3">
          <span className="block h-3.5 w-full max-w-[120px] animate-pulse rounded bg-white/[0.06]" />
        </td>
      ))}
    </tr>
  );
}

function PageBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-[#0F1412] text-[#C4D0C8] transition hover:border-white/25 hover:text-[#E8EFEA] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function FilterList({
  current,
  allLabel,
  options,
  onPick,
}: {
  current: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  const item = (value: string, label: string) => (
    <button
      key={value || "__all"}
      type="button"
      onClick={() => onPick(value)}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13.5px] transition hover:bg-white/[0.06] ${
        current === value ? "text-[#8BC53F]" : "text-[#E8EFEA]"
      }`}
    >
      {label}
      {current === value ? <span className="text-[#8BC53F]">✓</span> : null}
    </button>
  );
  return (
    <div className="grid max-h-[300px] gap-0.5 overflow-y-auto">
      {item("", allLabel)}
      {options.map((o) => item(o.value, o.label))}
    </div>
  );
}

/* ---------- misc ---------- */

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
