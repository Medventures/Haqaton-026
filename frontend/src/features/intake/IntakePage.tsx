import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Baby, Check, ChevronLeft, PencilLine, Phone, ShieldCheck } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import type { QuestionDef, QuestionnaireConfig } from "@/api/types";
import { track } from "@/analytics/tracker";
import { btnPrimary, btnSecondary, glass } from "@/components/patient/buttons";
import { PatientShell } from "@/components/patient/PatientTopBar";
import {
  applyExclusiveMulti,
  BLOCK_TITLES,
  consideredLabels,
  formatAnswer,
  isRequired,
  isVisible,
  localizeConfig,
  projectActiveAnswers,
  type Answers,
  type AnswerValue,
  type IntakeBlockId,
  validateAllVisible,
} from "@/features/intake/answersLogic";
import { startPreviewFlow, wipeMedicalFlow } from "@/features/intake/flowState";
import { applyDocumentLang, useUiLang, welcomeCopy, type UiLang } from "@/features/patient-home/welcome";
import { localizeApiError } from "@/features/patient-home/localize";
import { createId } from "@/lib/id";

/*
 * Quiz intake: one question per screen. The step lives in the URL (?q=<question id>),
 * pushed on every advance, so both our "Back" and the browser Back walk question by question.
 * Answers stay in module RAM only (never localStorage) and are wiped on consent decline.
 */

const AUTO_ADVANCE_MS = 240;
const CONSENT = "consent";
const REVIEW = "review";
const EXIT_KIDS = "exit_kids";
const EXIT_URGENT = "exit_urgent";

const URGENT_SYMPTOMS = ["chest_pain_severe", "breathing_severe", "fainting_now", "bleeding_uncontrolled"];

/** Early-exit pseudo-step for the answers so far, or null to continue the quiz. */
function exitStepFor(answers: Answers): typeof EXIT_KIDS | typeof EXIT_URGENT | null {
  const age = answers.age_years;
  if (typeof age === "number" && Number.isInteger(age) && age < 18) return EXIT_KIDS;
  const symptoms = answers.symptoms;
  if (Array.isArray(symptoms) && symptoms.some((s) => URGENT_SYMPTOMS.includes(s))) return EXIT_URGENT;
  return null;
}

const BLOCK_TITLES_KZ: Record<IntakeBlockId, string> = {
  about: "Сіз және мақсат",
  wellbeing: "Әл-ауқат",
  history: "Нені ескеру керек",
  results: "Тексеру тарихы",
  review: "Жауаптарды тексеру",
};

const QUIZ_COPY = {
  ru: {
    consentTitle: "Прежде чем начать",
    agree: "Согласен, начать",
    decline: "Не согласен",
    declined: "Без согласия ответы не сохраняются и подбор не запускается.",
    loading: "Загружаем анкету",
    unavailable: "Анкета недоступна",
    home: "На главную",
    reviewTitle: "Проверьте ответы",
    reviewSub: "Нажмите на ответ, чтобы изменить его.",
    noteHint: "Необязательно. Увидит только врач.",
    submit: "Показать подбор",
    required: "Выберите ответ",
    number: "Введите целое число",
    min: (n: number) => `Минимум ${n}`,
    max: (n: number) => `Максимум ${n}`,
    years: "лет",
    multiHint: "Можно выбрать несколько",
    fixErrors: "Проверьте ответы перед отправкой",
    edit: "Изменить",
    kidsTitle: "Для детей — детский чек-ап",
    kidsBody:
      "Эта анкета рассчитана на взрослых от 18 лет. Для детей 1–17 лет в клинике есть отдельная программа «Чек-ап «Детский»». Запишите ребёнка по телефону.",
    call: "Позвонить +7 747 094 26 21",
    urgentTitle: "Нужна срочная помощь",
    urgentBody: "Эти симптомы требуют не чек-апа, а срочной помощи. Если это происходит сейчас — позвоните по одному из номеров.",
    urgentTip: "Если человек без сознания — звоните 103 и следуйте указаниям диспетчера.",
    changeAnswer: "Изменить ответ",
    urgentCards: [
      {
        tel: "103",
        title: "103 — Скорая медицинская помощь",
        note: "Боль в груди, одышка, обморок, кровотечение.",
      },
      {
        tel: "112",
        title: "112 — Единая служба спасения",
        note: "Если не дозвонились до 103; работает с мобильного без баланса.",
      },
      {
        tel: "+77470942621",
        title: "+7 747 094 26 21 — Контакт-центр клиники",
        note: "Запись и вопросы — не для экстренных случаев.",
      },
    ],
  },
  kz: {
    consentTitle: "Бастамас бұрын",
    agree: "Келісемін, бастау",
    decline: "Келіспеймін",
    declined: "Келісімсіз жауаптар сақталмайды және іріктеу басталмайды.",
    loading: "Сауалнама жүктелуде",
    unavailable: "Сауалнама қолжетімсіз",
    home: "Басты бетке",
    reviewTitle: "Жауаптарды тексеріңіз",
    reviewSub: "Өзгерту үшін жауапты басыңыз.",
    noteHint: "Міндетті емес. Тек дәрігер көреді.",
    submit: "Іріктеуді көрсету",
    required: "Жауапты таңдаңыз",
    number: "Бүтін сан енгізіңіз",
    min: (n: number) => `Кемінде ${n}`,
    max: (n: number) => `Ең көбі ${n}`,
    years: "жас",
    multiHint: "Бірнешеуін таңдауға болады",
    fixErrors: "Жіберер алдында жауаптарды тексеріңіз",
    edit: "Өзгерту",
    kidsTitle: "Балаларға — балалар чек-апы",
    kidsBody:
      "Бұл сауалнама 18 жастан асқандарға арналған. 1–17 жас балаларға клиникада бөлек «Чек-ап «Балалар»» бағдарламасы бар. Баланы телефон арқылы жазыңыз.",
    call: "Қоңырау шалу +7 747 094 26 21",
    urgentTitle: "Шұғыл көмек қажет",
    urgentBody: "Бұл симптомдар чек-апты емес, шұғыл көмекті қажет етеді. Қазір болып жатса — төмендегі нөмірлердің біріне қоңырау шалыңыз.",
    urgentTip: "Егер адам есінен танған болса — 103-ке қоңырау шалып, диспетчердің нұсқауын орындаңыз.",
    changeAnswer: "Жауапты өзгерту",
    urgentCards: [
      {
        tel: "103",
        title: "103 — Жедел медициналық жәрдем",
        note: "Кеудедегі ауырсыну, ентігу, есінен тану, қан кету.",
      },
      {
        tel: "112",
        title: "112 — Бірыңғай құтқару қызметі",
        note: "103-ке хабарласа алмасаңыз; ұялы телефоннан балансыз жұмыс істейді.",
      },
      {
        tel: "+77470942621",
        title: "+7 747 094 26 21 — Клиника байланыс орталығы",
        note: "Жазылу мен сұрақтар — шұғыл жағдайларға емес.",
      },
    ],
  },
} as const;

type Draft = {
  answers: Answers;
  consent: boolean;
  doctorNote: string;
  started: boolean;
};

// Tab-RAM draft: survives quiz ↔ overview navigation, not a page reload.
let draft: Draft = { answers: {}, consent: false, doctorNote: "", started: false };

function lead(text: string) {
  const value = text.trim();
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase("ru-RU") + value.slice(1);
}

function hasValue(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function validateQuestion(q: QuestionDef, answers: Answers, lang: UiLang): string | null {
  const copy = QUIZ_COPY[lang];
  const value = answers[q.id];
  if (!hasValue(value)) return isRequired(q, answers) ? copy.required : null;
  if (q.answer_type === "number") {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(num)) return copy.number;
    if (q.validation?.min !== undefined && num < q.validation.min) return copy.min(q.validation.min);
    if (q.validation?.max !== undefined && num > q.validation.max) return copy.max(q.validation.max);
  }
  return null;
}

export function IntakePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lang = useUiLang();
  const copy = QUIZ_COPY[lang];
  const chrome = welcomeCopy[lang];

  const [rawConfig, setConfig] = useState<QuestionnaireConfig | null>(null);
  const config = useMemo(() => (rawConfig ? localizeConfig(rawConfig, lang) : null), [rawConfig, lang]);
  const [consentCopy, setConsentCopy] = useState<{ ru: string; kz: string | null }>({ ru: "", kz: null });
  const [consentVersion, setConsentVersion] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswersState] = useState<Answers>(draft.answers);
  const [consent, setConsentState] = useState(draft.consent);
  const [declined, setDeclined] = useState(false);
  const [doctorNote, setDoctorNoteState] = useState(draft.doctorNote);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const advanceTimer = useRef<number | null>(null);
  const prevIndex = useRef<number>(-1);
  const viewedBlocks = useRef(new Set<string>());

  useEffect(() => applyDocumentLang(lang), [lang]);

  useEffect(() => {
    track("page_viewed", { screen_id: "intake" });
    let cancelled = false;
    void Promise.all([api.questionnaire(), api.clinic()])
      .then(([questionnaire, clinic]) => {
        if (cancelled) return;
        setConfig(questionnaire);
        setConsentCopy({ ru: clinic.consent.processing_copy, kz: clinic.consent.processing_copy_kz ?? null });
        setConsentVersion(clinic.consent.processing_text_version);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(localizeApiError(err, lang, copy.unavailable));
        track("technical_error", { code: "intake_config_load" });
      });
    return () => {
      cancelled = true;
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  const setAnswers = useCallback((next: Answers) => {
    draft = { ...draft, answers: next };
    setAnswersState(next);
  }, []);

  const visible = useMemo(
    () => (config ? config.questions.filter((q) => isVisible(q, answers)) : []),
    [config, answers],
  );
  const answeredCount = useMemo(() => visible.filter((q) => hasValue(answers[q.id])).length, [visible, answers]);
  const liveProgress = useRef({ answered: answeredCount, total: visible.length });
  liveProgress.current = { answered: answeredCount, total: visible.length };
  const [frozenProgress, setFrozenProgress] = useState({ answered: 0, total: 0 });
  const stepParam = params.get("q");
  useEffect(() => {
    setFrozenProgress(liveProgress.current);
  }, [stepParam, visible.length === 0]);

  // No ?q=: consent screen first time; after consent (e.g. "edit answers" from overview) → review.
  const q = params.get("q") ?? (consent ? REVIEW : CONSENT);
  const fromReview = params.get("from") === REVIEW;
  const index = visible.findIndex((item) => item.id === q);
  const question = index >= 0 ? visible[index]! : null;

  // Guard the URL: no consent → consent; unknown/hidden id → first unanswered (or review).
  useEffect(() => {
    if (!config) return;
    if (!consent && q !== CONSENT) {
      setParams({ q: CONSENT }, { replace: true });
      return;
    }
    if (q === CONSENT || q === REVIEW) return;
    if (q === EXIT_KIDS || q === EXIT_URGENT) return;
    if (index < 0) {
      const firstOpen = visible.find((item) => !hasValue(answers[item.id]));
      setParams({ q: firstOpen ? firstOpen.id : REVIEW }, { replace: true });
    }
  }, [config, consent, q, index, visible, answers, setParams]);

  useEffect(() => {
    setError(null);
    if (question && !viewedBlocks.current.has(question.block)) {
      viewedBlocks.current.add(question.block);
      track("intake_step_viewed", { block_id: question.block });
    }
    // Per-question view, once per appearance (never the answer value).
    if (question) track("question_viewed", { question_id: question.id });
  }, [question]);

  const stepKey = q;
  const orderIndex = q === CONSENT ? -1 : q === REVIEW ? visible.length : index;
  const direction = orderIndex >= prevIndex.current ? "gc-slide-next" : "gc-slide-prev";
  useEffect(() => {
    prevIndex.current = orderIndex;
  }, [orderIndex]);

  function go(target: string, opts?: { fromReview?: boolean }) {
    const next: Record<string, string> = { q: target };
    if (opts?.fromReview) next.from = REVIEW;
    setParams(next);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
      return;
    }
    // Opened directly: step to the previous question on this host, never leave the origin.
    if (q === REVIEW && visible.length) setParams({ q: visible[visible.length - 1]!.id }, { replace: true });
    else if (index > 0) setParams({ q: visible[index - 1]!.id }, { replace: true });
    else if (q !== CONSENT) setParams({ q: CONSENT }, { replace: true });
    else navigate("/", { replace: true });
  }

  function targetAfter(current: QuestionDef, nextAnswers: Answers): string {
    const nextVisible = config!.questions.filter((item) => isVisible(item, nextAnswers));
    if (fromReview) {
      // Return to review unless the change opened a new required question.
      const open = nextVisible.find((item) => isRequired(item, nextAnswers) && !hasValue(nextAnswers[item.id]));
      return open ? open.id : REVIEW;
    }
    const pos = nextVisible.findIndex((item) => item.id === current.id);
    return nextVisible[pos + 1]?.id ?? REVIEW;
  }

  function advance(current: QuestionDef, nextAnswers = answers) {
    const problem = validateQuestion(current, nextAnswers, lang);
    if (problem) {
      setError(problem);
      return;
    }
    // The user moved past this question (never send the answer value).
    track("question_answered", { question_id: current.id });
    // Early exits after the triggering question (age < 18, urgent symptom).
    const exit = exitStepFor(nextAnswers);
    if (exit === EXIT_KIDS && current.id === "age_years") {
      go(EXIT_KIDS);
      return;
    }
    if (exit === EXIT_URGENT && current.id === "symptoms") {
      go(EXIT_URGENT);
      return;
    }
    if (current.id === visible[visible.length - 1]?.id || targetAfter(current, nextAnswers) === REVIEW) {
      track("intake_step_completed", { block_id: current.block });
    }
    const target = targetAfter(current, nextAnswers);
    go(target, target !== REVIEW && fromReview ? { fromReview: true } : undefined);
  }

  function answer(current: QuestionDef, value: AnswerValue | undefined, autoAdvance = false) {
    const next = { ...answers };
    if (value === undefined) delete next[current.id];
    else next[current.id] = value;
    setAnswers(next);
    setError(null);
    if (autoAdvance) {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(() => advance(current, next), AUTO_ADVANCE_MS);
    }
  }

  function grantConsent() {
    draft = { ...draft, consent: true };
    setConsentState(true);
    setDeclined(false);
    if (!draft.started) {
      draft = { ...draft, started: true };
      track("intake_started", { questionnaire_version: config?.questionnaire_version ?? "unknown" });
    }
    const firstOpen = visible.find((item) => !hasValue(answers[item.id]));
    go(firstOpen ? firstOpen.id : visible[0]?.id ?? REVIEW);
  }

  function declineConsent() {
    draft = { answers: {}, consent: false, doctorNote: "", started: false };
    setAnswersState({});
    setDoctorNoteState("");
    setConsentState(false);
    setDeclined(true);
    wipeMedicalFlow();
  }

  function setDoctorNote(value: string) {
    draft = { ...draft, doctorNote: value };
    setDoctorNoteState(value);
  }

  function submit() {
    if (!config || !consent || submitting) return;
    const note = doctorNote.trim();
    const maxNote = config.doctor_note.max_length || 200;
    if (note.length > maxNote) {
      setSubmitError(copy.max(maxNote));
      return;
    }
    const fieldErrors = validateAllVisible(config, answers);
    const firstBad = visible.find((item) => fieldErrors[item.id]);
    if (firstBad) {
      setSubmitError(copy.fixErrors);
      go(firstBad.id, { fromReview: true });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const revisionId = createId();
    const submission = {
      contract_version: "v4" as const,
      revision_id: revisionId,
      questionnaire_version: config.questionnaire_version,
      processing_consent: { granted: true, text_version: consentVersion },
      answers: projectActiveAnswers(config, answers),
      doctor_note: note.length ? note : null,
    };
    track("intake_step_completed", { block_id: "review" });
    track("intake_submitted", { questionnaire_version: config.questionnaire_version, mode: "anonymous" });
    startPreviewFlow({ revisionId, submission, consideredLabels: consideredLabels(config, answers) });
    setSubmitting(false);
    navigate("/overview", { state: { revisionId } });
  }


  if (loadError) {
    return (
      <PatientShell>
        <CenteredMessage title={copy.unavailable} body={loadError}>
          <Link to="/" className={btnSecondary}>
            {copy.home}
          </Link>
        </CenteredMessage>
      </PatientShell>
    );
  }

  if (!config) {
    return (
      <PatientShell>
        <CenteredMessage title={copy.loading}>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-[#03392D]/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[#03392D]/60" />
          </div>
        </CenteredMessage>
      </PatientShell>
    );
  }

  const blockTitle = question
    ? (lang === "kz" ? BLOCK_TITLES_KZ : BLOCK_TITLES)[question.block as IntakeBlockId] ?? ""
    : q === REVIEW
      ? (lang === "kz" ? BLOCK_TITLES_KZ : BLOCK_TITLES).review
      : "";
  // Progress is frozen per screen: picking an option (e.g. sex opens/hides the pregnancy
  // question) must not move the bar until the user presses «Далее».
  const { answered: shownAnswered, total } = frozenProgress;
  const pct = total ? Math.round((shownAnswered / total) * 100) : 0;
  const maxNote = config.doctor_note.max_length || 200;

  return (
    <PatientShell>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col px-5 pb-16 pt-28 md:pt-32">
        {q !== CONSENT && q !== EXIT_KIDS && q !== EXIT_URGENT ? (
          <div className="mb-8 grid gap-2.5" aria-live="polite">
            <div className="flex items-baseline justify-between text-[13px] font-semibold">
              <span className="uppercase tracking-[0.08em] text-[#03392D]/60">{blockTitle}</span>
              <span className="tabular-nums text-[#52655B]">{chrome.progress(shownAnswered, total)}</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[#03392D]/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={shownAnswered}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#03392D] to-[#2f7d4f] transition-[width] duration-500 ease-[cubic-bezier(.32,.72,0,1)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}

        <div key={stepKey} className={`${direction} flex flex-1 flex-col`}>
          {q === CONSENT ? (
            <section className="my-auto grid gap-7">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#03392D] text-white shadow-[0_10px_24px_rgba(3,57,45,.25)]">
                <ShieldCheck className="h-7 w-7" strokeWidth={1.8} aria-hidden />
              </span>
              <div className="grid gap-3">
                <h1 className="text-[34px] font-bold leading-[1.08] tracking-[-0.03em] text-[#10261E] md:text-[44px]">
                  {copy.consentTitle}
                </h1>
              </div>
              <p className={`${glass} rounded-3xl p-5 text-[16px] leading-relaxed text-[#18342A] md:p-6`}>{lang === "kz" ? consentCopy.kz ?? consentCopy.ru : consentCopy.ru}</p>
              {declined ? (
                <p role="status" className="rounded-2xl bg-[#fff4e5] px-4 py-3 text-[15px] text-[#7a4a00]">
                  {copy.declined}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" className={`group ${btnPrimary} w-full sm:w-auto sm:min-w-64`} onClick={grantConsent}>
                  <span className="truncate">{copy.agree}</span>
                  <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                </button>
                <button type="button" className={`${btnSecondary} w-full sm:w-auto`} onClick={declineConsent}>
                  <span className="truncate">{copy.decline}</span>
                </button>
              </div>
            </section>
          ) : null}

          {question ? (
            <QuestionScreen
              key={question.id}
              question={question}
              value={answers[question.id]}
              error={error}
              lang={lang}
              onAnswer={(value, auto) => answer(question, value, auto)}
              onNext={() => advance(question)}
              onBack={goBack}
            />
          ) : null}

          {q === REVIEW ? (
            <section className="grid gap-6">
              <div className="grid gap-2">
                <h1 className="text-[34px] font-bold leading-[1.08] tracking-[-0.03em] text-[#10261E] md:text-[44px]">
                  {copy.reviewTitle}
                </h1>
                <p className="text-[16px] text-[#52655B]">{copy.reviewSub}</p>
              </div>
              <ul className="grid gap-2.5">
                {visible
                  .filter((item) => hasValue(answers[item.id]))
                  .map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => go(item.id, { fromReview: true })}
                        className={`${glass} group flex w-full items-center gap-4 rounded-3xl px-5 py-4 text-left transition active:scale-[0.99]`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] text-[#52655B]">{lead(item.label)}</span>
                          <span className="mt-0.5 block text-[16px] font-semibold text-[#18342A]">
                            {lead(formatAnswer(item, answers[item.id]!))}
                          </span>
                        </span>
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#03392D]/[0.06] text-[#03392D]/70 transition group-hover:bg-[#03392D] group-hover:text-white">
                          <PencilLine className="h-4 w-4" aria-label={copy.edit} />
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
              <label className={`${glass} grid gap-2 rounded-3xl p-5`} htmlFor="doctor-note">
                <span className="text-[15px] font-semibold text-[#18342A]">{lead(config.doctor_note.label)}</span>
                <span className="text-[13px] text-[#52655B]">{copy.noteHint}</span>
                <textarea
                  id="doctor-note"
                  className="mt-1 min-h-24 w-full resize-none rounded-2xl border border-[#03392D]/12 bg-white px-4 py-3 text-[16px] outline-none transition focus:border-[#03392D]/50 focus:ring-4 focus:ring-[#03392D]/10"
                  maxLength={maxNote}
                  value={doctorNote}
                  onChange={(e) => setDoctorNote(e.target.value)}
                  aria-describedby="doctor-note-count"
                />
                <span id="doctor-note-count" className="justify-self-end text-[13px] tabular-nums text-[#52655B]">
                  {doctorNote.length}/{maxNote}
                </span>
              </label>
              {submitError ? (
                <p role="alert" className="text-[15px] font-medium text-[#b42318]">
                  {submitError}
                </p>
              ) : null}
              <NavRow
                backLabel={chrome.back}
                nextLabel={copy.submit}
                onBack={goBack}
                onNext={submit}
                nextDisabled={submitting}
              />
            </section>
          ) : null}

          {q === EXIT_KIDS ? (
            <section className="grid flex-1 place-content-center justify-items-center gap-7 py-8 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[#03392D] text-white shadow-[0_10px_24px_rgba(3,57,45,.25)]">
                <Baby className="h-8 w-8" strokeWidth={1.8} aria-hidden />
              </span>
              <div className="grid max-w-md gap-3">
                <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-[#10261E] md:text-[40px]">
                  {copy.kidsTitle}
                </h1>
                <p className="text-[16px] leading-relaxed text-[#52655B]">{copy.kidsBody}</p>
              </div>
              <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  className={`group ${btnPrimary} w-full sm:w-auto sm:min-w-56`}
                  onClick={() => navigate("/")}
                >
                  <span className="truncate">{copy.home}</span>
                  <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                </button>
                <a href="tel:+77470942621" className={`${btnSecondary} w-full sm:w-auto`}>
                  <Phone className="h-5 w-5 shrink-0 text-[#03392D]/70" strokeWidth={1.8} aria-hidden />
                  <span className="truncate">{copy.call}</span>
                </a>
              </div>
            </section>
          ) : null}

          {q === EXIT_URGENT ? (
            <section className="grid flex-1 place-content-center justify-items-center gap-6 py-8 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[#b42318]/12 text-[#b42318] ring-1 ring-[#b42318]/20">
                <AlertTriangle className="h-8 w-8" strokeWidth={1.8} aria-hidden />
              </span>
              <div className="grid max-w-md gap-3">
                <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-[#10261E] md:text-[40px]">
                  {copy.urgentTitle}
                </h1>
                <p className="text-[16px] leading-relaxed text-[#52655B]">{copy.urgentBody}</p>
              </div>
              <ul className="grid w-full max-w-md gap-2.5 text-left">
                {copy.urgentCards.map((card) => (
                  <li key={card.tel}>
                    <a
                      href={`tel:${card.tel}`}
                      className="group flex items-center gap-4 rounded-3xl border border-[#03392D]/12 bg-white px-5 py-4 transition hover:border-[#03392D]/25 hover:bg-[#03392D]/[0.03] active:scale-[0.99]"
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#8BC53F]/18 text-[#2f5a12]">
                        <Phone className="h-5 w-5" strokeWidth={1.9} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-semibold text-[#10261E]">{card.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-[#52655B]">{card.note}</span>
                      </span>
                      <ArrowRight className="h-5 w-5 shrink-0 text-[#03392D]/40 transition group-hover:translate-x-0.5" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="max-w-md rounded-2xl bg-[#03392D]/[0.05] px-4 py-3 text-[14px] leading-snug text-[#18342A]">
                {copy.urgentTip}
              </p>
              <button type="button" className={btnSecondary} onClick={goBack}>
                <ChevronLeft className="h-5 w-5 shrink-0 text-[#03392D]/70" aria-hidden />
                <span className="truncate">{copy.changeAnswer}</span>
              </button>
            </section>
          ) : null}
        </div>
      </main>
    </PatientShell>
  );
}

function CenteredMessage({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-[100dvh] max-w-md place-content-center justify-items-center gap-5 px-6 text-center">
      <h1 className="text-3xl font-bold tracking-[-0.02em]">{title}</h1>
      {body ? <p className="text-[#52655B]">{body}</p> : null}
      {children}
    </main>
  );
}

function QuestionScreen({
  question,
  value,
  error,
  lang,
  onAnswer,
  onNext,
  onBack,
}: {
  question: QuestionDef;
  value: AnswerValue | undefined;
  error: string | null;
  lang: UiLang;
  onAnswer: (value: AnswerValue | undefined, autoAdvance: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const copy = QUIZ_COPY[lang];
  const chrome = welcomeCopy[lang];
  const options = question.options ?? [];
  const errorId = `q-${question.id}-error`;
  const titleId = `q-${question.id}-title`;
  const firstRef = useRef<HTMLButtonElement | HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  // Keyboard shortcuts 1–9 mark options (Typeform-like); Enter = next.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (question.answer_type === "number") return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= options.length && !event.metaKey && !event.ctrlKey) {
      const option = options[n - 1]!;
      event.preventDefault();
      if (question.answer_type === "single") onAnswer(option.code, false);
      else onAnswer(applyExclusiveMulti(question, Array.isArray(value) ? value : [], option.code), false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onNext();
    }
  }

  const heading = (
    <h1 id={titleId} className="text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-[#10261E] md:text-[42px]">
      {lead(question.label)}
    </h1>
  );

  const errorLine = error ? (
    <p id={errorId} role="alert" className="text-[15px] font-medium text-[#b42318]">
      {error}
    </p>
  ) : null;

  if (question.answer_type === "number") {
    const num = typeof value === "number" ? value : undefined;
    const min = question.validation?.min ?? 0;
    const max = question.validation?.max ?? 120;
    return (
      <section className="flex flex-1 flex-col gap-10">
        {heading}
        <div className="grid justify-items-center gap-4">
          <div className="flex h-24 w-full max-w-[280px] items-center justify-center gap-3 rounded-[28px] border border-[#03392D]/12 bg-white px-6 transition focus-within:border-[#03392D]/50 focus-within:ring-4 focus-within:ring-[#03392D]/10">
            <input
              ref={(el) => {
                firstRef.current = el;
              }}
              aria-labelledby={titleId}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="—"
              value={num ?? ""}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, "").slice(0, 3);
                const parsed = raw === "" ? undefined : Math.min(max, Number(raw));
                onAnswer(parsed, false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onNext();
              }}
              className="gc-age-input w-[2.6ch] bg-transparent text-center text-[56px] font-bold leading-none tabular-nums tracking-[-0.04em] text-[#10261E] outline-none placeholder:text-[#b7c7c0] md:text-[64px]"
            />
            <span className="text-lg font-medium text-[#52655B]">{copy.years}</span>
          </div>
          {errorLine}
        </div>
        <NavRow
          backLabel={chrome.back}
          nextLabel={chrome.next}
          onBack={onBack}
          onNext={onNext}
          nextDisabled={num === undefined || num < min}
        />
      </section>
    );
  }

  const multiple = question.answer_type === "multi";
  const selected = multiple ? (Array.isArray(value) ? value : []) : [];
  const layout = !multiple && options.length === 2 ? "grid grid-cols-2 gap-3" : "grid gap-2.5";
  const answered = multiple ? selected.length > 0 : value !== undefined;

  return (
    <section className="flex flex-1 flex-col gap-8" onKeyDown={onKeyDown}>
      <div className="grid gap-3">
        {heading}
        {multiple ? <p className="text-[15px] font-medium text-[#52655B]">{copy.multiHint}</p> : null}
      </div>
      <div
        role={multiple ? "group" : "radiogroup"}
        aria-labelledby={titleId}
        aria-describedby={error ? errorId : undefined}
        className={layout}
      >
        {options.map((option, i) => {
          const on = multiple ? selected.includes(option.code) : value === option.code;
          const tall = !multiple && options.length === 2;
          return (
            <button
              key={option.code}
              ref={
                i === 0
                  ? (el) => {
                      firstRef.current = el;
                    }
                  : undefined
              }
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() =>
                multiple
                  ? onAnswer(applyExclusiveMulti(question, selected, option.code), false)
                  : onAnswer(option.code, false)
              }
              className={`group flex w-full items-center gap-4 rounded-[22px] border px-5 text-left transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#03392D] focus-visible:ring-offset-2 ${
                tall ? "min-h-[88px] flex-col justify-center gap-2 text-center" : "min-h-16 py-3"
              } ${
                on
                  ? "border-[#03392D] bg-[#03392D] text-white shadow-[0_10px_24px_rgba(3,57,45,.22)]"
                  : "border-white/70 bg-white/75 text-[#18342A] shadow-[0_1px_2px_rgba(3,57,45,.05)] backdrop-blur-xl hover:border-[#03392D]/25 hover:bg-white"
              }`}
            >
              {!tall ? (
                <span
                  aria-hidden
                  className={`hidden h-7 w-7 shrink-0 place-items-center rounded-lg border text-[12px] font-semibold tabular-nums sm:grid ${
                    on ? "border-white/30 text-white/80" : "border-[#03392D]/15 text-[#03392D]/55"
                  }`}
                >
                  {i + 1}
                </span>
              ) : null}
              <span className={`text-[17px] font-semibold leading-snug ${tall ? "" : "flex-1"}`}>{lead(option.label)}</span>
              {!tall ? (
                <span
                  aria-hidden
                  className={`grid h-6 w-6 shrink-0 place-items-center border-2 transition ${multiple ? "rounded-md" : "rounded-full"} ${
                    on ? "border-white bg-white text-[#03392D]" : "border-[#03392D]/25 bg-transparent"
                  }`}
                >
                  {on ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {errorLine}
      <NavRow
        backLabel={chrome.back}
        nextLabel={chrome.next}
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!answered}
      />
    </section>
  );
}

function NavRow({
  backLabel,
  nextLabel,
  onBack,
  onNext,
  nextDisabled,
}: {
  backLabel: string;
  nextLabel: string;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto -mx-5 flex items-center justify-between gap-3 bg-gradient-to-t from-white/85 to-transparent px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:m-0 sm:bg-none sm:p-0 sm:pt-2">
      <button
        type="button"
        onClick={onBack}
        className={`${btnSecondary} flex-1 sm:flex-none sm:min-w-40`}
      >
        <ChevronLeft className="h-5 w-5 shrink-0 text-[#03392D]/70" aria-hidden />
        <span className="truncate">{backLabel}</span>
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className={`group ${btnPrimary} flex-1 sm:flex-none sm:min-w-56`}
      >
        <span className="truncate">{nextLabel}</span>
        <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
      </button>
    </div>
  );
}
