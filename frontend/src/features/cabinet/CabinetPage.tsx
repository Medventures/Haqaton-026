import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Home,
  LayoutGrid,
  LogIn,
  LogOut,
  Plus,
  Sparkles,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiClientError, api } from "@/api/client";
import type { HealthCard, PatientCaseSummary } from "@/api/types";
import { track } from "@/analytics/tracker";
import { initials, logoutPatient, usePatient } from "@/app/patientSession";
import {
  AppShell,
  ShellAccount,
  ShellMenuItem,
  ShellPrimaryButton,
  serifHeading,
  shellCard,
  type ShellNavItem,
  type ShellRecentItem,
} from "@/components/app/AppShell";
import { openLogin } from "@/components/patient/loginSheetStore";
import { applyDocumentLang, setUiLang, useUiLang, type UiLang } from "@/features/patient-home/welcome";

import { CABINET_COPY, STEPS } from "./copy";
import { VisitsCalendar } from "./VisitsCalendar";

type PrepTask = { id: string; action: string; status: string; due_at: string | null; kind?: string };
type Tab = "overview" | "visits" | "prep" | "results";

function parseTab(raw: string | null): Tab {
  if (raw === "visits" || raw === "prep" || raw === "results") return raw;
  return "overview";
}

function fmt(lang: UiLang, value: string | null | undefined, withTime = true): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00+05:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "kz" ? "kk-KZ" : "ru-RU", {
    day: "numeric",
    month: "long",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Asia/Almaty",
  }).format(date);
}

function shortDate(lang: UiLang, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value.length === 10 ? `${value}T00:00:00+05:00` : value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(lang === "kz" ? "kk-KZ" : "ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Almaty",
  }).format(date);
}

function caseDot(c: PatientCaseSummary): "green" | "amber" | "grey" {
  if (c.appointment_status === "clinic_request_pending") return "amber";
  if (c.appointment_status === "demo_confirmed" || c.appointment_status === "clinic_confirmed") return "green";
  return "grey";
}

export function CabinetPage() {
  const lang = useUiLang();
  const copy = CABINET_COPY[lang];
  const { me, status } = usePatient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const askedLogin = useRef(false);
  const [welcomePhone, setWelcomePhone] = useState<string | null>(null);

  useEffect(() => applyDocumentLang(lang), [lang]);
  useEffect(() => track("page_viewed", { screen_id: "cabinet" }), []);

  // One-time welcome banner right after a booking created the cabinet.
  useEffect(() => {
    const raw = window.sessionStorage.getItem("gc.welcome");
    if (!raw) return;
    window.sessionStorage.removeItem("gc.welcome");
    try {
      const parsed = JSON.parse(raw) as { phone?: string };
      setWelcomePhone(parsed.phone ?? me?.phone ?? "");
    } catch {
      setWelcomePhone(me?.phone ?? "");
    }
  }, []);

  useEffect(() => {
    if (status === "anonymous" && !me && !askedLogin.current) {
      askedLogin.current = true;
      openLogin("/cabinet");
    }
  }, [status, me]);

  // ---- Not logged in ----
  if (!me) {
    return (
      <div className="grid min-h-[100dvh] place-content-center bg-[#FBFCFA] px-6" translate="no">
        <div className={`${shellCard} grid w-[min(92vw,420px)] justify-items-center gap-5 p-8 text-center`}>
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#03392D] text-white">
            <LogIn className="h-6 w-6" aria-hidden />
          </span>
          <h1 className={`${serifHeading} text-[26px] text-[#10261E]`}>{copy.signInTitle}</h1>
          <p className="text-[#52655B]">{copy.signInBody}</p>
          <button
            type="button"
            onClick={() => openLogin("/cabinet")}
            className="group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-[#03392D] px-6 text-[15px] font-semibold leading-none text-white transition hover:bg-[#02281f] active:scale-[0.99]"
          >
            <span className="truncate">{copy.signIn}</span>
            <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </button>
          <p className="text-[12px] text-[#52655B]">{copy.demo}</p>
        </div>
      </div>
    );
  }

  const current = me.cases[me.cases.length - 1] ?? null;
  const firstName = me.display_name.split(/\s+/)[0] ?? me.display_name;

  const nav: ShellNavItem[] = [
    { to: "/cabinet", label: copy.tabOverview, icon: <LayoutGrid className="h-[18px] w-[18px]" aria-hidden />, end: true },
    { to: "/cabinet?tab=visits", label: copy.tabVisits, icon: <CalendarDays className="h-[18px] w-[18px]" aria-hidden /> },
    { to: "/cabinet?tab=prep", label: copy.tabPrep, icon: <ClipboardCheck className="h-[18px] w-[18px]" aria-hidden /> },
    { to: "/cabinet?tab=results", label: copy.tabResults, icon: <FileText className="h-[18px] w-[18px]" aria-hidden /> },
  ];

  const recent: ShellRecentItem[] = me.cases
    .slice()
    .reverse()
    .map((c) => ({
      key: c.case_id,
      to: "/cabinet",
      label: c.selected_program_name ?? copy.programFallback,
      meta: shortDate(lang, c.booked_starts_at),
      dot: caseDot(c),
      active: current ? c.case_id === current.case_id : false,
    }));

  // New check-up for a signed-in patient: reuse the latest answers and programme and go
  // straight to the booking calendar; without a saved questionnaire → the quiz.
  async function bookAgain() {
    try {
      const last = await api.patientLastRequest();
      navigate("/booking", {
        state: {
          submission: {
            contract_version: "v4",
            revision_id: `rebook-${Date.now()}`,
            questionnaire_version: "demo-intake-v1",
            processing_consent: { granted: true, text_version: "demo-processing-v1" },
            answers: last.answers,
            doctor_note: last.doctor_note,
          },
          selected_package_id: last.package_id,
          program_name: last.program_name,
          price_minor: last.price_minor,
          price_old_minor: last.price_old_minor,
          currency: "KZT",
          consultation_reason: last.consultation_reason,
        },
      });
    } catch {
      navigate("/intake");
    }
  }

  const primaryAction = (
    <ShellPrimaryButton icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => void bookAgain()}>
      {copy.newCheckup}
    </ShellPrimaryButton>
  );

  const account = (
    <ShellAccount initials={initials(me.display_name)} name={me.display_name} subtitle={me.phone ?? undefined}>
      <ShellMenuItem icon={<Home className="h-[18px] w-[18px]" aria-hidden />} onClick={() => navigate("/")}>
        {copy.toHome}
      </ShellMenuItem>
      <div className="my-1 flex items-center gap-1 px-2 py-1">
        <span className="mr-auto text-[12px] text-[#52655B]">{copy.language}</span>
        <LangToggle lang={lang} />
      </div>
      <ShellMenuItem
        icon={<LogOut className="h-[18px] w-[18px]" aria-hidden />}
        onClick={() => {
          void logoutPatient().then(() => navigate("/"));
        }}
      >
        {copy.logout}
      </ShellMenuItem>
    </ShellAccount>
  );

  return (
    <AppShell primaryAction={primaryAction} nav={nav} recentTitle={copy.tabVisits} recent={recent} account={account} wide>
      {welcomePhone !== null ? (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#8BC53F]/40 bg-[#8BC53F]/12 px-4 py-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#03392D] text-white">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-[14px] leading-snug text-[#18342A]">{copy.welcome(welcomePhone)}</p>
          <button
            type="button"
            onClick={() => setWelcomePhone(null)}
            className="shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold text-[#03392D] transition hover:bg-[#03392D]/[0.06]"
          >
            {copy.welcomeDismiss}
          </button>
        </div>
      ) : null}
      {current ? (
        <CabinetBody
          key={current.case_id + tab}
          current={current}
          allCases={me.cases}
          firstName={firstName}
          lang={lang}
          tab={tab}
          setTab={(t) => {
            const next = new URLSearchParams(params);
            if (t === "overview") next.delete("tab");
            else next.set("tab", t);
            setParams(next, { replace: true });
          }}
        />
      ) : (
        <EmptyCabinet copy={copy} firstName={firstName} onStart={() => navigate("/intake")} />
      )}
      <p className="mt-10 text-[12px] text-[#52655B]">{copy.demo}</p>
    </AppShell>
  );
}

function LangToggle({ lang }: { lang: UiLang }) {
  return (
    <div className="flex overflow-hidden rounded-full border border-[#03392D]/12" onClick={(e) => e.stopPropagation()}>
      {(["ru", "kz"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setUiLang(code)}
          className={`px-3 py-1 text-[12px] font-semibold uppercase transition ${
            lang === code ? "bg-[#03392D] text-white" : "bg-white text-[#52655B] hover:bg-[#03392D]/[0.05]"
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

function EmptyCabinet({ copy, firstName, onStart }: { copy: (typeof CABINET_COPY)[UiLang]; firstName: string; onStart: () => void }) {
  return (
    <div>
      <Greeting name={firstName} text={copy.hello(firstName)} />
      <div className={`${shellCard} mt-6 grid gap-3 p-6`}>
        <p className="text-[15px] font-semibold text-[#10261E]">{copy.emptyTitle}</p>
        <p className="text-[14px] text-[#52655B]">{copy.emptyBody}</p>
        <button
          type="button"
          onClick={onStart}
          className="group mt-1 inline-flex h-11 w-fit items-center justify-center gap-2.5 rounded-full bg-[#03392D] px-5 text-[14.5px] font-semibold leading-none text-white transition hover:bg-[#02281f] active:scale-[0.99]"
        >
          <span className="truncate">{copy.newCheckup}</span>
          <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function Greeting({ name, text }: { name: string; text: string }) {
  void name;
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#8BC53F]/20 text-[#5a9a1f]">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <h1 className={`${serifHeading} text-[30px] leading-tight text-[#10261E] md:text-[36px]`}>{text}</h1>
    </div>
  );
}

function CabinetBody({
  current,
  allCases,
  firstName,
  lang,
  tab,
  setTab,
}: {
  current: PatientCaseSummary;
  allCases: PatientCaseSummary[];
  firstName: string;
  lang: UiLang;
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const copy = CABINET_COPY[lang];
  const navigate = useNavigate();
  const [prep, setPrep] = useState<PrepTask[] | null>(null);
  const [prepLocked, setPrepLocked] = useState(false);
  const [health, setHealth] = useState<HealthCard | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([api.preparation(current.case_id), api.healthCard(current.case_id)]).then(([p, h]) => {
      if (cancelled) return;
      if (p.status === "fulfilled") setPrep(((p.value as { tasks?: PrepTask[] }).tasks ?? []) as PrepTask[]);
      else {
        setPrep([]);
        const err = p.reason;
        if (err instanceof ApiClientError && (err.status === 409 || err.code === "plan_not_approved")) setPrepLocked(true);
      }
      if (h.status === "fulfilled") setHealth(h.value);
      else setHealth({ case_id: current.case_id, is_demo: true, reports: [], tasks: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [current.case_id]);

  async function toggleTask(task: PrepTask) {
    const next = task.status === "completed" ? "active" : "completed";
    setBusyTask(task.id);
    setPrep((prev) => prev?.map((t) => (t.id === task.id ? { ...t, status: next } : t)) ?? prev);
    try {
      await api.patchTask(task.id, { status: next });
    } catch {
      setPrep((prev) => prev?.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)) ?? prev);
    } finally {
      setBusyTask(null);
    }
  }

  const followUps = useMemo(() => (health?.tasks ?? []).filter((t) => t.kind === "follow_up"), [health]);
  const reports = health?.reports ?? [];
  const [nextTitle, nextBody] = copy.stageNext[current.stage] ?? [copy.nextStep, ""];

  const nextCta = (() => {
    switch (current.stage) {
      case "questionnaire_saved":
      case "package_selected":
        return { label: copy.ctaIntake, onClick: () => navigate("/intake") };
      case "physician_plan_confirmed":
      case "preparation_in_progress":
        return { label: copy.ctaPrep, onClick: () => setTab("prep") };
      case "results_available":
        return { label: copy.ctaResults, onClick: () => setTab("results") };
      case "follow_up_planned":
        return { label: copy.ctaResults, onClick: () => setTab("results") };
      default:
        return null;
    }
  })();

  const apptWhen = fmt(lang, current.booked_starts_at);

  if (tab === "visits") {
    return <VisitsTab cases={allCases} lang={lang} onOpenOverview={() => setTab("overview")} />;
  }
  if (tab === "prep") {
    return (
      <PrepTab
        copy={copy}
        lang={lang}
        prep={prep}
        prepLocked={prepLocked}
        busyTask={busyTask}
        onToggle={toggleTask}
      />
    );
  }
  if (tab === "results") {
    return <ResultsTab copy={copy} lang={lang} reports={reports} followUps={followUps} loading={health === null} />;
  }

  // ---- Overview tab ----
  return (
    <div>
      <Greeting name={firstName} text={copy.hello(firstName)} />

      {/* Composer-like next step card */}
      <div className={`${shellCard} mt-6 rounded-3xl p-5 md:p-6`}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#03392D]/55">{copy.nextStep}</p>
        <h2 className="mt-2 text-[20px] font-bold leading-snug tracking-[-0.01em] text-[#10261E]">{nextTitle}</h2>
        {nextBody ? <p className="mt-1 text-[14.5px] text-[#52655B]">{nextBody}</p> : null}
        {nextCta ? (
          <button
            type="button"
            onClick={nextCta.onClick}
            className="group mt-4 inline-flex h-11 items-center justify-center gap-2.5 rounded-full bg-[#03392D] px-5 text-[14.5px] font-semibold leading-none text-white transition hover:bg-[#02281f] active:scale-[0.99]"
          >
            <span className="truncate">{nextCta.label}</span>
            <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Journey stepper (minimal horizontal) */}
      <MiniStepper steps={STEPS[lang]} current={current.step_index} />

      {/* Nearest appointment */}
      <div className={`${shellCard} mt-4 p-5 md:p-6`}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#03392D]/55">{copy.appointment}</p>
        {apptWhen ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-[24px] font-bold leading-tight tracking-[-0.01em] text-[#10261E]">{apptWhen}</p>
            {current.appointment_status ? (
              <StatusChip tone={current.appointment_status === "clinic_request_pending" ? "amber" : "green"}>
                {copy.appt[current.appointment_status] ?? current.appointment_status}
              </StatusChip>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-[#52655B]">{copy.noAppointment}</p>
        )}
      </div>

      {/* Program */}
      <div className={`${shellCard} mt-4 p-5 md:p-6`}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#03392D]/55">{copy.program}</p>
        <p className="mt-2 text-[17px] font-semibold leading-snug text-[#10261E]">
          {current.selected_program_name ?? copy.programUnknown}
        </p>
        <p className="mt-1 text-[13px] text-[#52655B]">{copy.programNote}</p>
      </div>
    </div>
  );
}

function MiniStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-3">
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={now ? "step" : undefined}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                done
                  ? "bg-[#03392D] text-white"
                  : now
                    ? "bg-[#8BC53F] text-[#10261E]"
                    : "border border-[#03392D]/15 bg-white text-[#03392D]/45"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            <span className={`text-[13px] ${now ? "font-semibold text-[#10261E]" : done ? "text-[#18342A]" : "text-[#52655B]"}`}>
              {label}
            </span>
            {i < steps.length - 1 ? <span className="mx-1 h-px w-4 bg-[#03392D]/12" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function VisitsTab({
  cases,
  lang,
  onOpenOverview,
}: {
  cases: PatientCaseSummary[];
  lang: UiLang;
  onOpenOverview: () => void;
}) {
  const copy = CABINET_COPY[lang];
  const withAppt = cases.filter((c) => c.booked_starts_at);
  return (
    <div>
      <h2 className={`${serifHeading} text-[26px] text-[#10261E]`}>{copy.tabVisits}</h2>
      {withAppt.length ? (
        <div className="mt-5">
          <VisitsCalendar
            cases={cases}
            lang={lang}
            programFallback={copy.programFallback}
            statusLabel={(st) => (st ? copy.appt[st] ?? st : null)}
          />
        </div>
      ) : null}
      {withAppt.length === 0 ? (
        <p className="mt-4 text-[#52655B]">{copy.visitsEmpty}</p>
      ) : (
        <ul className="mt-5 overflow-hidden rounded-2xl border border-[#03392D]/[0.09] bg-white">
          {withAppt.map((c, i) => (
            <li key={c.case_id}>
              <button
                type="button"
                onClick={onOpenOverview}
                className={`flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-[#03392D]/[0.03] ${
                  i > 0 ? "border-t border-[#03392D]/[0.07]" : ""
                }`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#03392D]/[0.06] text-[#03392D]">
                  <CalendarDays className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-[#10261E]">{fmt(lang, c.booked_starts_at)}</span>
                  <span className="block truncate text-[13px] text-[#52655B]">{c.selected_program_name ?? copy.programFallback}</span>
                </span>
                {c.appointment_status ? (
                  <StatusChip tone={c.appointment_status === "clinic_request_pending" ? "amber" : "green"}>
                    {copy.appt[c.appointment_status] ?? c.appointment_status}
                  </StatusChip>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PrepTab({
  copy,
  lang,
  prep,
  prepLocked,
  busyTask,
  onToggle,
}: {
  copy: (typeof CABINET_COPY)[UiLang];
  lang: UiLang;
  prep: PrepTask[] | null;
  prepLocked: boolean;
  busyTask: string | null;
  onToggle: (t: PrepTask) => void;
}) {
  const done = (prep ?? []).filter((t) => t.status === "completed").length;
  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className={`${serifHeading} flex-1 text-[26px] text-[#10261E]`}>{copy.prep}</h2>
        {prep && prep.length ? (
          <span className="rounded-full bg-[#03392D]/[0.06] px-3 py-1 text-[13px] font-semibold tabular-nums text-[#03392D]">
            {done}/{prep.length}
          </span>
        ) : null}
      </div>
      {prep === null ? (
        <SkeletonRows />
      ) : prepLocked || prep.length === 0 ? (
        <p className="mt-4 text-[#52655B]">{copy.prepEmpty}</p>
      ) : (
        <ul className="mt-5 grid gap-2">
          {prep.map((task) => {
            const isDone = task.status === "completed";
            return (
              <li key={task.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  disabled={busyTask === task.id}
                  onClick={() => onToggle(task)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-[#03392D]/[0.09] bg-white px-4 py-3 text-left transition hover:bg-[#03392D]/[0.03] active:scale-[0.995]"
                >
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
                      isDone ? "border-[#03392D] bg-[#03392D] text-white" : "border-[#03392D]/25"
                    }`}
                    aria-hidden
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] leading-snug ${isDone ? "text-[#52655B] line-through" : "text-[#18342A]"}`}>
                      {task.action}
                    </span>
                    <span className="mt-1 block text-[13px] text-[#52655B]">
                      {copy.due}: {fmt(lang, task.due_at) ?? copy.dueUnknown}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ResultsTab({
  copy,
  lang,
  reports,
  followUps,
  loading,
}: {
  copy: (typeof CABINET_COPY)[UiLang];
  lang: UiLang;
  reports: HealthCard["reports"];
  followUps: HealthCard["tasks"];
  loading: boolean;
}) {
  return (
    <div>
      <h2 className={`${serifHeading} text-[26px] text-[#10261E]`}>{copy.results}</h2>

      {loading ? (
        <SkeletonRows />
      ) : reports.length === 0 ? (
        <p className="mt-4 text-[#52655B]">{copy.resultsEmpty}</p>
      ) : (
        <ul className="mt-5 grid gap-2">
          {reports.map((report) => (
            <li key={report.id}>
              <details className="group rounded-2xl border border-[#03392D]/[0.09] bg-white open:bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#03392D]/[0.06] text-[#03392D]">
                    <FileText className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-[#18342A]">{report.title}</span>
                    <span className="text-[13px] text-[#52655B]">{fmt(lang, report.observed_on, false) ?? "—"}</span>
                  </span>
                  <StatusChip tone={report.review_status === "pending" ? "amber" : "green"}>
                    {copy.review[report.review_status] ?? report.review_status}
                  </StatusChip>
                  <ChevronDown className="h-4 w-4 shrink-0 text-[#03392D]/50 transition group-open:rotate-180" aria-hidden />
                </summary>
                <div className="grid gap-2 px-4 pb-4">
                  {report.observations.map((obs) => (
                    <div key={obs.id} className="grid gap-0.5 rounded-xl bg-[#F4F8F5] px-3 py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[14px] text-[#18342A]">{obs.name}</span>
                        <span className="text-[15px] font-semibold tabular-nums text-[#10261E]">
                          {obs.value ?? "—"} {obs.unit ?? ""}
                        </span>
                      </div>
                      {obs.reference_range ? <span className="text-[12px] text-[#52655B]">{obs.reference_range}</span> : null}
                      {obs.source_span ? (
                        <span className="text-[12px] text-[#52655B]">
                          {copy.source}: «{obs.source_span}»
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-8 text-[15px] font-semibold text-[#10261E]">{copy.follow}</h3>
      {loading ? (
        <SkeletonRows />
      ) : followUps.length === 0 ? (
        <p className="mt-3 text-[#52655B]">{copy.followEmpty}</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {followUps.map((task) => (
            <li key={task.id} className="rounded-2xl border border-[#03392D]/[0.09] bg-white px-4 py-3">
              <p className="text-[15px] leading-snug text-[#18342A]">{task.action}</p>
              <p className="mt-1 text-[13px] text-[#52655B]">
                {copy.due}: {fmt(lang, task.due_at) ?? copy.dueUnknown}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusChip({ tone, children }: { tone: "green" | "amber"; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${
        tone === "green" ? "bg-[#8BC53F]/18 text-[#2f5a12]" : "bg-[#f5b544]/20 text-[#7a4a00]"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone === "green" ? "bg-[#5a9a1f]" : "bg-[#d98e04]"}`} aria-hidden />
      {children}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="mt-5 grid gap-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-2xl bg-[#03392D]/[0.05]" />
      ))}
    </div>
  );
}
