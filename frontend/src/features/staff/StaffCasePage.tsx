import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ClipboardList, Route as RouteIcon } from "lucide-react";
import { ApiClientError, api } from "@/api/client";
import type { HealthCard } from "@/api/types";
import { getActor, useActor } from "@/app/actor";
import { serifHeading } from "@/components/app/AppShell";
import { StaffLayout } from "@/features/staff/StaffLayout";
import {
  appointmentStatusLabel,
  dash,
  formatDateOnly,
  formatDateTime,
  programLabel,
  stageLabel,
} from "@/features/staff/format";
import { cardDark, inputDark } from "@/features/staff/dark";
import { caseRevisionId, type StaffCaseDetail } from "@/features/staff/types";

const DEMO_TEMPLATE_ID = "demo-plan-basic";

type TabKey = "profile" | "program" | "results" | "notes";

function actionErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 403) return "Недоступно для вашей роли";
    return err.message;
  }
  return "Действие не выполнено";
}

export function StaffCasePage() {
  return (
    <StaffLayout>
      <StaffCaseInner />
    </StaffLayout>
  );
}

function StaffCaseInner() {
  const { caseId = "" } = useParams();
  const role = useActor().role;
  // Demo admin has both coordinator and doctor rights.
  const isDoctor = role === "doctor" || role === "admin";
  const isCoordinator = role === "coordinator" || role === "admin";

  const [detail, setDetail] = useState<StaffCaseDetail | null>(null);
  const [health, setHealth] = useState<HealthCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>("profile");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const [preferredDate, setPreferredDate] = useState("");

  const load = useCallback(async () => {
    if (!caseId) {
      setError("Карточка не указана");
      setLoading(false);
      return;
    }
    const actor = getActor();
    if (actor.role !== "coordinator" && actor.role !== "doctor" && actor.role !== "admin") {
      setError("Недоступно для вашей роли");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const payload = (await api.staffCase(caseId)) as StaffCaseDetail;
      setDetail(payload);
      setNotes(payload.notes ?? "");
      setOwner(payload.owner_id ?? "");
      setPreferredDate(payload.preferred_date ?? "");
      try {
        setHealth(await api.healthCard(caseId));
      } catch {
        setHealth(null);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? (err.status === 403 ? "Недоступно для вашей роли" : err.message) : "Не удалось загрузить карточку");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [caseId, role]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreatePlan() {
    if (!caseId || !detail) return;
    const revision = caseRevisionId(detail);
    setActionBusy(true);
    setActionError(null);
    try {
      await api.createPlan(caseId, { revision_id: revision ?? "", template_id: DEMO_TEMPLATE_ID });
      await load();
    } catch (err: unknown) {
      setActionError(actionErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onReviewResults() {
    if (!caseId || !detail) return;
    const revision = caseRevisionId(detail);
    setActionBusy(true);
    setActionError(null);
    try {
      await api.reviewResults(caseId, { revision_id: revision ?? "" });
      await load();
    } catch (err: unknown) {
      setActionError(actionErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onBuildRoute() {
    if (!caseId) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.createRoute(caseId);
      await load();
    } catch (err: unknown) {
      setActionError(actionErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function onPatch() {
    if (!caseId) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = (await api.patchStaffCase(caseId, {
        notes,
        owner_id: owner || undefined,
        preferred_date: preferredDate || null,
      })) as StaffCaseDetail;
      setDetail(updated);
      setNotes(updated.notes ?? "");
      setOwner(updated.owner_id ?? "");
      setPreferredDate(updated.preferred_date ?? "");
    } catch (err: unknown) {
      setActionError(actionErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return <p className="text-[14px] text-[#9AABA2]">Загрузка карточки…</p>;
  if (error) {
    return (
      <div>
        <p className="mb-4 text-[14px] text-[#F07167]">{error}</p>
        <Link className="text-[#8BC53F] underline" to="/staff">
          К списку клиентов
        </Link>
      </div>
    );
  }
  if (!detail) return null;

  const stage = detail.stage;
  const hasPlan = Boolean(detail.plan);
  const reports = detail.reports ?? health?.reports ?? [];
  const questionnaire = detail.questionnaire;

  // Primary action available to the current role at this stage.
  let primary: { label: string; icon: JSX.Element; run: () => void } | null = null;
  if (isDoctor && stage === "consultation_completed" && !hasPlan) {
    primary = { label: "Утвердить план", icon: <CheckCircle2 className="h-4 w-4" aria-hidden />, run: () => void onCreatePlan() };
  } else if (isDoctor && (stage === "results_available" || detail.next_action === "review_results")) {
    primary = { label: "Разобрать результаты", icon: <ClipboardList className="h-4 w-4" aria-hidden />, run: () => void onReviewResults() };
  } else if (isCoordinator && stage === "physician_plan_confirmed" && hasPlan) {
    primary = { label: "Построить маршрут", icon: <RouteIcon className="h-4 w-4" aria-hidden />, run: () => void onBuildRoute() };
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "profile", label: "Профиль и анкета" },
    { key: "program", label: "Программа и визиты" },
    { key: "results", label: "Результаты" },
    { key: "notes", label: "Заметки" },
  ];

  return (
    <div>
      <Link to="/staff" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] text-[#9AABA2] hover:text-[#E8EFEA]">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Клиенты
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] pb-5">
        <div>
          <h1 className={`${serifHeading} text-[28px] text-[#E8EFEA]`}>{detail.display_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-[#9AABA2]">
            <span className="tabular-nums">{dash(detail.phone)}</span>
            <span className="inline-flex items-center rounded-full bg-[#8BC53F]/15 px-2.5 py-1 text-[12px] font-medium text-[#B9E07F]">
              {stageLabel(stage)}
            </span>
          </div>
        </div>
        {primary ? (
          <button
            type="button"
            onClick={primary.run}
            disabled={actionBusy}
            className="flex h-11 items-center gap-2 rounded-xl bg-[#8BC53F] px-4 text-[14.5px] font-semibold text-[#0F1412] transition hover:bg-[#9BD455] disabled:opacity-60"
          >
            {primary.icon}
            {primary.label}
          </button>
        ) : null}
      </div>

      {actionError ? <p className="mt-3 text-[13.5px] text-[#F07167]">{actionError}</p> : null}

      <div className="mt-6 flex gap-5 border-b border-white/[0.07]">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2.5 text-[14px] transition ${
              tab === t.key ? "border-[#8BC53F] font-semibold text-[#E8EFEA]" : "border-transparent text-[#9AABA2] hover:text-[#E8EFEA]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "profile" ? (
          <div className={`${cardDark} p-5`}>
            <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
              <div>
                <dt className="text-[13px] text-[#9AABA2]">Контактное имя</dt>
                <dd className="text-[#E8EFEA]">{dash(detail.contact_name)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-[#9AABA2]">Телефон</dt>
                <dd className="tabular-nums text-[#E8EFEA]">{dash(detail.phone)}</dd>
              </div>
            </dl>
            <div className="mt-5">
              <h2 className="mb-2 text-[15px] font-semibold text-[#E8EFEA]">Анкета</h2>
              {isDoctor ? (
                questionnaire ? (
                  <div className="grid gap-2 text-[14px]">
                    {questionnaire.doctor_note ? (
                      <p className="text-[#E8EFEA]">
                        <span className="text-[#9AABA2]">Заметка для врача: </span>
                        {questionnaire.doctor_note}
                      </p>
                    ) : null}
                    <div className="overflow-hidden rounded-xl border border-white/[0.07]">
                      {(questionnaire.active_fields.length ? questionnaire.active_fields : Object.keys(questionnaire.answers)).map((field) => (
                        <div key={field} className="flex justify-between gap-4 border-b border-white/[0.07] px-3 py-2 last:border-0">
                          <span className="text-[#9AABA2]">{field}</span>
                          <span className="text-right tabular-nums text-[#E8EFEA]">{String(questionnaire.answers[field] ?? "—")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[14px] text-[#9AABA2]">Ответы анкеты для этой карточки недоступны.</p>
                )
              ) : (
                <p className="text-[14px] text-[#9AABA2]">Анкета доступна врачу.</p>
              )}
            </div>
          </div>
        ) : null}

        {tab === "program" ? (
          <div className={`${cardDark} p-5`}>
            <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
              <div>
                <dt className="text-[13px] text-[#9AABA2]">Выбранная программа</dt>
                <dd className="text-[#E8EFEA]">{programLabel(detail.selected_program_id)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-[#9AABA2]">Желаемая дата</dt>
                <dd className="tabular-nums text-[#E8EFEA]">{formatDateOnly(detail.preferred_date)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-[#9AABA2]">Время записи</dt>
                <dd className="tabular-nums text-[#E8EFEA]">{formatDateTime(detail.booked_starts_at)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-[#9AABA2]">Статус приёма</dt>
                <dd className="text-[#E8EFEA]">{appointmentStatusLabel(detail.appointment_status)}</dd>
              </div>
            </dl>
            {detail.plan ? (
              <div className="mt-5 rounded-xl border border-white/[0.07] px-4 py-3 text-[14px]">
                <div className="font-semibold text-[#E8EFEA]">План врача подтверждён</div>
                <div className="mt-1 text-[#9AABA2]">
                  Услуги: {detail.plan.services?.length ? detail.plan.services.join(", ") : "—"}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "results" ? (
          <div className={`${cardDark} p-5`}>
            {reports.length === 0 ? (
              <p className="text-[14px] text-[#9AABA2]">Результатов пока нет или они недоступны для роли.</p>
            ) : (
              <div className="grid gap-4">
                {reports.map((report) => (
                  <div key={report.id} className="border-b border-white/[0.07] pb-4 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-[#E8EFEA]">{report.title}</h3>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[12px] text-[#9AABA2]">{report.review_status}</span>
                      <span className="tabular-nums text-[13px] text-[#9AABA2]">{formatDateOnly(report.observed_on)}</span>
                    </div>
                    <ul className="mt-2 grid gap-2">
                      {report.observations.map((obs) => (
                        <li key={obs.id} className="rounded-xl border border-white/[0.07] px-3 py-2 text-[13.5px]">
                          <div className="font-medium text-[#E8EFEA]">{obs.name}</div>
                          <div className="text-[#9AABA2]">
                            {obs.value ?? "—"} {obs.unit ?? ""} · референс {obs.reference_range ?? "—"} · {obs.assertion}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "notes" ? (
          <div className={`${cardDark} p-5`}>
            {isCoordinator ? (
              <div className="grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-[13px] font-medium text-[#9AABA2]">Заметки координатора</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={`min-h-28 w-full px-3 py-2 text-[14px] ${inputDark}`}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-[13px] font-medium text-[#9AABA2]">Ответственный сотрудник</span>
                    <input
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      className={`h-11 w-full px-3 text-[14px] ${inputDark}`}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-[13px] font-medium text-[#9AABA2]">Желаемая дата</span>
                    <input
                      type="date"
                      value={preferredDate}
                      onChange={(e) => setPreferredDate(e.target.value)}
                      className={`h-11 w-full px-3 text-[14px] tabular-nums [color-scheme:dark] ${inputDark}`}
                    />
                  </label>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => void onPatch()}
                    disabled={actionBusy}
                    className="h-11 rounded-xl bg-[#8BC53F] px-4 text-[14.5px] font-semibold text-[#0F1412] transition hover:bg-[#9BD455] disabled:opacity-60"
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid gap-3 text-[14px]">
                <div>
                  <dt className="text-[13px] text-[#9AABA2]">Заметки</dt>
                  <dd className="text-[#E8EFEA]">{dash(detail.notes)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-[#9AABA2]">Ответственный</dt>
                  <dd className="text-[#E8EFEA]">{dash(detail.owner_id)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-[#9AABA2]">Желаемая дата</dt>
                  <dd className="tabular-nums text-[#E8EFEA]">{formatDateOnly(detail.preferred_date)}</dd>
                </div>
                <p className="text-[13px] text-[#9AABA2]">Заметки редактирует координатор.</p>
              </dl>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
