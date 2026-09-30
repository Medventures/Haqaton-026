import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Preview } from "@/api/types";
import { track } from "@/analytics/tracker";
import { btnPrimary, btnSecondary } from "@/components/patient/buttons";
import { PatientShell } from "@/components/patient/PatientTopBar";
import {
  getFlow,
  startPreviewFlow,
  subscribeFlow,
  type OverviewLocationState,
  type ProgramsLocationState,
} from "@/features/intake/flowState";
import { applyDocumentLang, useUiLang } from "@/features/patient-home/welcome";
import "@/features/overview/overview.css";

const STEP_MS = 450;
const MIN_VISIBLE_MS = 1_800;
const trackedStarts = new Set<string>();
const trackedCompletes = new Set<string>();

const COPY = {
  ru: {
    title: "Готовим ваш отчёт",
    sub: "Подбираем программу по вашим ответам.",
    steps: [
      "Читаем ваши ответы",
      "Проверяем безопасность",
      "Сопоставляем с программами клиники",
      "Готовим объяснения",
    ],
    handoffTitle: "Нужен другой маршрут",
    handoffSub: "Обычный подбор программ для этого исхода не показываем.",
    home: "На главную",
    errorTitle: "Не удалось подготовить отчёт",
    retry: "Попробовать ещё раз",
    editAnswers: "Изменить ответы",
    noFlowTitle: "Отчёт недоступен",
    noFlowSub: "Подбор запускается после анкеты. Ответы не восстанавливаются из адреса страницы.",
    toIntake: "К анкете",
  },
  kz: {
    title: "Есебіңізді дайындап жатырмыз",
    sub: "Жауаптарыңыз бойынша бағдарлама таңдап жатырмыз.",
    steps: [
      "Жауаптарыңызды оқып жатырмыз",
      "Қауіпсіздікті тексереміз",
      "Клиника бағдарламаларымен салыстырамыз",
      "Түсіндірмелерді дайындаймыз",
    ],
    handoffTitle: "Басқа бағыт қажет",
    handoffSub: "Бұл нәтиже үшін әдеттегі бағдарлама таңдауы көрсетілмейді.",
    home: "Басты бетке",
    errorTitle: "Есепті дайындау мүмкін болмады",
    retry: "Қайта көру",
    editAnswers: "Жауаптарды өзгерту",
    noFlowTitle: "Есеп қолжетімсіз",
    noFlowSub: "Іріктеу сауалнамадан кейін басталады. Жауаптар мекенжайдан қалпына келмейді.",
    toIntake: "Сауалнамаға",
  },
} as const;

function isHandoffClass(workflow: Preview["workflow_class"]): boolean {
  return workflow === "safety_stop" || workflow === "adult_scope_excluded";
}

export function OverviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const lang = useUiLang();
  const copy = COPY[lang];
  const revisionId = (location.state as OverviewLocationState | null)?.revisionId;
  const flow = useSyncExternalStore(subscribeFlow, getFlow, getFlow);

  const [stepIndex, setStepIndex] = useState(0);
  const [minElapsed, setMinElapsed] = useState(false);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const navigatedRef = useRef(false);

  const matched = !!revisionId && !!flow && flow.revisionId === revisionId ? flow : null;
  const preview = matched?.status === "ready" ? matched.preview : null;
  const previewError = matched?.status === "error" ? matched.errorMessage : null;
  const handoff = preview ? isHandoffClass(preview.workflow_class) : false;

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  useEffect(() => {
    track("page_viewed", { screen_id: "overview" });
  }, []);

  // overview_started once per revision.
  useEffect(() => {
    if (!revisionId || !matched) return;
    if (startedRef.current || trackedStarts.has(revisionId)) return;
    startedRef.current = true;
    trackedStarts.add(revisionId);
    track("overview_started", { revision_token: revisionId });
  }, [revisionId, matched]);

  // Tick the checklist steps ~450ms apart (skip while handoff/error).
  useEffect(() => {
    if (!matched || handoff || previewError) return;
    const timers = COPY.ru.steps.map((_, i) =>
      window.setTimeout(() => setStepIndex((prev) => Math.max(prev, i + 1)), STEP_MS * (i + 1)),
    );
    const minTimer = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(minTimer);
    };
  }, [matched, handoff, previewError]);

  // Handoff: track completion once.
  useEffect(() => {
    if (!handoff || !preview || !revisionId || completedRef.current) return;
    if (trackedCompletes.has(revisionId)) return;
    completedRef.current = true;
    trackedCompletes.add(revisionId);
    track("overview_completed", { revision_token: revisionId, handoff: true });
  }, [handoff, preview, revisionId]);

  // Navigate to /programs once the preview is ready and the minimum display elapsed.
  useEffect(() => {
    if (handoff || previewError || !revisionId || !preview) return;
    if (preview.revision_id !== revisionId) return;
    if (!minElapsed || navigatedRef.current) return;
    navigatedRef.current = true;
    if (!completedRef.current && !trackedCompletes.has(revisionId)) {
      completedRef.current = true;
      trackedCompletes.add(revisionId);
      track("overview_completed", { revision_token: revisionId });
    }
    const state: ProgramsLocationState = { preview };
    navigate("/programs", { state });
  }, [handoff, previewError, revisionId, preview, minElapsed, navigate]);

  function retry() {
    const snapshot = getFlow();
    if (!snapshot) {
      navigate("/intake");
      return;
    }
    navigatedRef.current = false;
    completedRef.current = false;
    setStepIndex(0);
    setMinElapsed(false);
    startPreviewFlow({
      revisionId: snapshot.revisionId,
      submission: snapshot.submission,
      consideredLabels: snapshot.consideredLabels,
    });
  }

  // No matching flow state → friendly message.
  if (!revisionId || !matched) {
    return (
      <PatientShell>
        <CenteredCard title={copy.noFlowTitle} body={copy.noFlowSub}>
          <Link to="/intake" className={btnSecondary}>
            {copy.toIntake}
          </Link>
        </CenteredCard>
      </PatientShell>
    );
  }

  // Error → retry / edit answers.
  if (previewError) {
    return (
      <PatientShell>
        <CenteredCard title={copy.errorTitle} body={previewError}>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button type="button" className={`group ${btnPrimary} w-full sm:w-auto sm:min-w-56`} onClick={retry}>
              <RefreshCw className="h-5 w-5 shrink-0" aria-hidden />
              <span className="truncate">{copy.retry}</span>
            </button>
            <Link to="/intake" className={`${btnSecondary} w-full sm:w-auto`}>
              <span className="truncate">{copy.editAnswers}</span>
            </Link>
          </div>
        </CenteredCard>
      </PatientShell>
    );
  }

  // Safety stop / adult scope excluded → handoff immediately.
  if (handoff && preview) {
    const lines = preview.questions_for_doctor.length ? preview.questions_for_doctor : [preview.state];
    return (
      <PatientShell>
        <CenteredCard title={copy.handoffTitle} body={copy.handoffSub}>
          <div className="grid w-full gap-2 text-left">
            {lines.map((text) => (
              <p key={text} className="rounded-2xl bg-[#03392D]/[0.05] px-4 py-3 text-[15px] text-[#18342A]">
                {text}
              </p>
            ))}
          </div>
          <Link to="/" className={btnSecondary}>
            {copy.home}
          </Link>
        </CenteredCard>
      </PatientShell>
    );
  }

  const total = copy.steps.length;
  const ratio = Math.min(1, stepIndex / total);

  return (
    <PatientShell>
      <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center gap-10 px-6 pb-16 pt-28 text-center">
        <ProgressRing ratio={ratio} />
        <div className="grid gap-2">
          <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-[#10261E] md:text-[38px]">
            {copy.title}
          </h1>
          <p className="text-[16px] text-[#52655B]">{copy.sub}</p>
        </div>
        <ul className="grid w-full max-w-sm gap-2.5" aria-live="polite">
          {copy.steps.map((label, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <li
                key={label}
                className={`gc-step flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-[15px] font-medium transition-colors ${
                  done
                    ? "border-[#03392D]/15 bg-white/75 text-[#18342A]"
                    : active
                      ? "border-[#03392D]/20 bg-white/60 text-[#18342A]"
                      : "border-white/60 bg-white/35 text-[#52655B]"
                }`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <StepIcon done={done} active={active} />
                <span>{label}</span>
              </li>
            );
          })}
        </ul>
      </main>
    </PatientShell>
  );
}

function ProgressRing({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  const size = 128;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Indeterminate spinning arc (~30% of the circle); the % text reflects step progress.
  const arc = c * 0.3;
  return (
    <div className="relative grid place-items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id="gc-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#03392D" />
            <stop offset="100%" stopColor="#4f8f2c" />
          </linearGradient>
        </defs>
        <circle className="gc-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="gc-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={`${arc} ${c - arc}`}
        />
      </svg>
      <span key={pct} className="gc-ring-pct absolute text-[24px] font-bold tabular-nums tracking-[-0.02em] text-[#10261E]">
        {pct}%
      </span>
    </div>
  );
}

function StepIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#03392D] text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            className="gc-check-path"
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${
        active ? "border-[#03392D]/40" : "border-[#03392D]/15"
      }`}
    >
      {active ? <span className="h-2 w-2 animate-pulse rounded-full bg-[#03392D]" /> : null}
    </span>
  );
}

function CenteredCard({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto grid min-h-[100dvh] max-w-md place-content-center justify-items-center gap-5 px-6 pt-28 text-center">
      <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#10261E]">{title}</h1>
      {body ? <p className="text-[#52655B]">{body}</p> : null}
      {children}
    </main>
  );
}
