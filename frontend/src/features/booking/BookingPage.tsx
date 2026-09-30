import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Stethoscope, Check, ArrowRight, CalendarPlus, ClipboardList } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { track } from "@/analytics/tracker";
import { api, ApiClientError } from "@/api/client";
import type { Appointment, Slot } from "@/api/types";
import { adoptPatientSession, usePatient } from "@/app/patientSession";
import { PatientShell } from "@/components/patient/PatientTopBar";
import { applyDocumentLang, useUiLang } from "@/features/patient-home/welcome";

import { BOOKING_COPY, type BookingCopy } from "./copy";
import {
  MONTH_MAX,
  MONTH_MIN,
  addMonth,
  buildMonthGrid,
  isWeekend,
  monthKey,
  monthTitle,
  sameMonth,
} from "./calendar";
import { nextIdempotencyKey } from "./idempotency";
import { formatPhoneMask, isPhoneComplete } from "./phone";
import { formatSlotClock, toDateKey } from "./time";
import { resolveSubmission, type BookingLocationState } from "./types";
import { PriceBlock } from "@/features/recommendations/ProgramsPage";

import "./booking.css";

type ClinicConfig = Awaited<ReturnType<typeof api.clinic>>;
type TherapistInfo = { id: string; display_name: string; is_demo: boolean };
type MonthDay = { date: string; available: number; busy: number };
type UiLang = "ru" | "kz";

const DEFAULT_REASON = "discuss_preliminary_programme";
const panelClass =
  "w-full max-w-5xl rounded-[32px] border border-white/70 bg-white/70 shadow-[0_1px_2px_rgba(3,57,45,.06),0_24px_60px_rgba(3,57,45,.12)] backdrop-blur-xl";

function slotBucket(iso: string, tz: string): "morning" | "afternoon" | "evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(iso)),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function fmtLongDate(day: Date, lang: UiLang): string {
  return new Intl.DateTimeFormat(lang === "kz" ? "kk-KZ" : "ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Almaty",
  }).format(day);
}

export function BookingPage() {
  const lang = useUiLang() as UiLang;
  const copy = BOOKING_COPY[lang];
  const location = useLocation();
  const navigate = useNavigate();
  const { me } = usePatient();

  const navState = (location.state as BookingLocationState | null) ?? null;
  const submission = resolveSubmission(navState);
  const selectedPackageId = navState?.selected_package_id ?? navState?.packageId ?? null;
  const programName = navState?.program_name ?? null;
  const priceMinor = navState?.price_minor ?? null;
  const priceOldMinor = navState?.price_old_minor ?? null;
  const priceCurrency = navState?.currency ?? null;
  const consultationReason = navState?.consultation_reason ?? navState?.consultationReason ?? DEFAULT_REASON;
  const preferredDate = navState?.preferred_date ?? null;

  const [clinic, setClinic] = useState<ClinicConfig | null>(null);
  const [clinicError, setClinicError] = useState<string | null>(null);
  const [, setTherapist] = useState<TherapistInfo | null>(null);
  const [timezone, setTimezone] = useState("Asia/Almaty");

  const [visibleMonth, setVisibleMonth] = useState<Date>(MONTH_MIN);
  const [monthDays, setMonthDays] = useState<MonthDay[] | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const monthDefaulted = useRef(false);

  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const [transferGranted, setTransferGranted] = useState(false);
  const [reminderGranted, setReminderGranted] = useState(false);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const reminderAtBookingRef = useRef(false);
  const prefilled = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);

  const requestSeq = useRef(0);
  const monthSeq = useRef(0);
  const idempotencyKeyRef = useRef<string | null>(null);
  const idempotencyFingerprintRef = useRef<string | null>(null);
  const caseRef = useRef<{ caseId: string; revisionId: string; ownerSession: string } | null>(null);
  const submittingRef = useRef(false);
  const openedTracked = useRef(false);

  useEffect(() => applyDocumentLang(lang), [lang]);

  useEffect(() => {
    if (openedTracked.current) return;
    openedTracked.current = true;
    track("booking_opened");
  }, []);

  // Prefill contact fields from the logged-in patient.
  useEffect(() => {
    if (prefilled.current || !me) return;
    prefilled.current = true;
    setContactName((prev) => prev || me.display_name || "");
    if (me.phone) setPhone((prev) => prev || formatPhoneMask(me.phone ?? ""));
  }, [me]);

  // Load clinic config once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await api.clinic();
        if (cancelled) return;
        setClinic(config);
        setTimezone(config.timezone || "Asia/Almaty");
      } catch (err) {
        if (cancelled) return;
        setClinicError(err instanceof Error ? err.message : "Не удалось загрузить клинику");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load month availability whenever month or clinic changes.
  useEffect(() => {
    if (!clinic?.therapist_id) return;
    const seq = ++monthSeq.current;
    setMonthLoading(true);
    void (async () => {
      try {
        const result = await api.availabilityMonth(clinic.therapist_id, monthKey(visibleMonth));
        if (seq !== monthSeq.current) return;
        setMonthDays(result.days);
        setTimezone(result.timezone || clinic.timezone || "Asia/Almaty");
        // Default the visible month to the month of the first available day (once).
        if (!monthDefaulted.current) {
          monthDefaulted.current = true;
          const firstAvail = result.days.find((d) => d.available > 0);
          if (!firstAvail) {
            // No availability in MONTH_MIN → try the next month automatically.
            setVisibleMonth((m) => (sameMonth(m, MONTH_MAX) ? m : addMonth(m, 1)));
          }
        }
      } catch {
        if (seq !== monthSeq.current) return;
        setMonthDays([]);
      } finally {
        if (seq === monthSeq.current) setMonthLoading(false);
      }
    })();
  }, [clinic?.therapist_id, clinic?.timezone, visibleMonth]);

  // Load per-day slots when a day is selected.
  useEffect(() => {
    if (!selectedDay || !clinic?.therapist_id) {
      setSlots(null);
      setSlotsLoading(false);
      setSlotsError(null);
      return;
    }
    const seq = ++requestSeq.current;
    const dateKey = toDateKey(selectedDay);
    setSlotsLoading(true);
    setSlotsError(null);
    setSlots(null);
    void (async () => {
      try {
        const result = await api.availability(clinic.therapist_id, dateKey);
        if (seq !== requestSeq.current) return;
        setSlots(result.slots);
        setTherapist(result.therapist);
        setTimezone(result.timezone || clinic.timezone || "Asia/Almaty");
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setSlots([]);
        setSlotsError(err instanceof Error ? err.message : "Не удалось загрузить слоты");
      } finally {
        if (seq === requestSeq.current) setSlotsLoading(false);
      }
    })();
  }, [selectedDay, clinic?.therapist_id, clinic?.timezone]);

  const monthMap = useMemo(() => {
    const map = new Map<string, MonthDay>();
    (monthDays ?? []).forEach((d) => map.set(d.date, d));
    return map;
  }, [monthDays]);

  function selectDay(day: Date) {
    setSelectedDay(day);
    setSelectedSlotId(null);
    setConflictMessage(null);
    setSubmitError(null);
  }

  function selectSlot(slot: Slot) {
    if (slot.availability !== "available") return;
    setSelectedSlotId(slot.id);
    setConflictMessage(null);
    setSubmitError(null);
    track("slot_selected");
  }

  function onTransferChange(granted: boolean) {
    setTransferGranted(granted);
    if (granted) track("clinic_transfer_consented");
  }

  async function refreshAvailabilityKeepingDay() {
    if (!selectedDay || !clinic?.therapist_id) return;
    const seq = ++requestSeq.current;
    const dateKey = toDateKey(selectedDay);
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const result = await api.availability(clinic.therapist_id, dateKey);
      if (seq !== requestSeq.current) return;
      setSlots(result.slots);
      setTherapist(result.therapist);
      setTimezone(result.timezone || clinic.timezone || "Asia/Almaty");
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setSlotsError(err instanceof Error ? err.message : "Не удалось обновить слоты");
    } finally {
      if (seq === requestSeq.current) setSlotsLoading(false);
    }
    // Also refresh month dots.
    try {
      const monthResult = await api.availabilityMonth(clinic.therapist_id, monthKey(visibleMonth));
      setMonthDays(monthResult.days);
    } catch {
      /* keep prior month data */
    }
  }

  async function handleBook() {
    if (submittingRef.current || appointment) return;
    setSubmitError(null);
    setConflictMessage(null);
    setNameError(null);
    setPhoneError(null);

    if (!selectedSlotId) {
      setSubmitError(copy.errSlot);
      return;
    }
    if (!transferGranted) {
      setSubmitError(copy.errConsent);
      return;
    }
    let hasFieldError = false;
    if (!contactName.trim()) {
      setNameError(copy.errNameRequired);
      hasFieldError = true;
    }
    if (!isPhoneComplete(phone)) {
      setPhoneError(copy.errPhoneInvalid);
      hasFieldError = true;
    }
    if (hasFieldError) return;
    if (!submission) {
      setSubmitError(copy.errNoSubmission);
      return;
    }
    if (!clinic) {
      setSubmitError(copy.errConfig);
      return;
    }

    const { key, fingerprint } = nextIdempotencyKey(
      idempotencyKeyRef.current,
      idempotencyFingerprintRef.current,
      selectedSlotId,
    );
    idempotencyKeyRef.current = key;
    idempotencyFingerprintRef.current = fingerprint;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      let cid = caseRef.current?.caseId;
      let revisionId = caseRef.current?.revisionId;

      if (!cid || !revisionId) {
        const created = await api.createCase({
          ...submission,
          clinic_transfer: {
            granted: true,
            text_version: clinic.consent.transfer_text_version,
          },
          reminder_opt_in: reminderGranted,
          contact_name: contactName.trim(),
          phone: phone.trim(),
          selected_package_id: selectedPackageId,
          consultation_reason: consultationReason,
          preferred_date: preferredDate ?? (selectedDay ? toDateKey(selectedDay) : null),
        });
        caseRef.current = {
          caseId: created.case_id,
          revisionId: created.revision_id,
          ownerSession: created.owner_session,
        };
        cid = created.case_id;
        revisionId = created.revision_id;
      }

      const booked = await api.book(
        cid,
        {
          slot_id: selectedSlotId,
          revision_id: revisionId,
          consultation_reason: consultationReason,
        },
        key,
      );
      reminderAtBookingRef.current = reminderGranted;
      setCaseId(cid);
      setAppointment(booked);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409 && err.code === "slot_conflict") {
        setConflictMessage(copy.errConflict);
        setSelectedSlotId(null);
        idempotencyKeyRef.current = null;
        idempotencyFingerprintRef.current = null;
        await refreshAvailabilityKeepingDay();
      } else if (err instanceof ApiClientError && err.status === 422 && err.code === "phone_invalid") {
        setPhoneError(copy.errPhoneInvalid);
      } else {
        setSubmitError(err instanceof Error ? err.message : copy.errGeneric);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function openCabinet() {
    setAdopting(true);
    try {
      const token = caseRef.current?.ownerSession;
      if (token) await adoptPatientSession(token);
      // One-time welcome banner in the cabinet, with the sign-in phone.
      const digits = phone.replace(/\D/g, "");
      const normalized = digits.length === 11 ? `+${digits}` : phone.trim();
      // Banner only for a newly created cabinet, not for a patient booking again.
      if (!me) window.sessionStorage.setItem("gc.welcome", JSON.stringify({ phone: normalized }));
    } catch {
      /* still navigate; cabinet will ask for login if needed */
    } finally {
      navigate("/cabinet");
    }
  }

  const selectedSlot = slots?.find((s) => s.id === selectedSlotId) ?? null;

  // ---- Render: success ----
  if (appointment) {
    return (
      <PatientShell>
        <div className="flex min-h-[100dvh] items-center justify-center px-4 py-24">
          <SuccessView
            appointment={appointment}
            caseId={caseId}
            copy={copy}
            lang={lang}
            selectedDay={selectedDay}
            slot={selectedSlot}
            timezone={timezone}
            onOpenCabinet={openCabinet}
            adopting={adopting}
            reminderConsented={reminderAtBookingRef.current}
          />
        </div>
      </PatientShell>
    );
  }

  // ---- Render: clinic load error ----
  if (clinicError) {
    return (
      <PatientShell>
        <div className="flex min-h-[100dvh] items-center justify-center px-4 py-24">
          <div className={`${panelClass} grid gap-4 p-8 text-center`}>
            <h1 className="text-3xl font-bold tracking-[-0.02em]">{copy.unavailableTitle}</h1>
            <p className="text-[#52655B]" role="alert">
              {clinicError}
            </p>
            <Link
              to="/"
              className="mx-auto inline-flex h-12 items-center rounded-full bg-[#03392D] px-6 text-[15px] font-semibold text-white"
            >
              {copy.toHome}
            </Link>
          </div>
        </div>
      </PatientShell>
    );
  }

  // ---- Render: no nav state (opened directly, no submission) ----
  if (!submission) {
    return (
      <PatientShell>
        <div className="flex min-h-[100dvh] items-center justify-center px-4 py-24">
          <div className={`${panelClass} grid justify-items-center gap-5 p-8 text-center md:p-12`}>
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-[#03392D]/[0.07] text-[#03392D]">
              <ClipboardList className="h-7 w-7" aria-hidden />
            </span>
            <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#10261E] md:text-4xl">{copy.gateTitle}</h1>
            <p className="max-w-md text-[#52655B]">{copy.gateBody}</p>
            <Link
              to="/intake"
              className="group inline-flex h-14 items-center justify-center gap-2.5 rounded-full bg-[#03392D] px-6 text-[17px] font-semibold leading-none text-white shadow-[0_12px_28px_rgba(3,57,45,.22)] transition hover:bg-[#02281f] active:scale-[0.98]"
            >
              <span className="truncate">{copy.gateCta}</span>
              <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>
      </PatientShell>
    );
  }

  const canPrev = !sameMonth(visibleMonth, MONTH_MIN);
  const canNext = !sameMonth(visibleMonth, MONTH_MAX);
  const grid = buildMonthGrid(visibleMonth);

  const canSubmit =
    Boolean(selectedSlotId) &&
    transferGranted &&
    contactName.trim().length > 0 &&
    isPhoneComplete(phone) &&
    !submitting;

  return (
    <PatientShell>
      <div className="flex min-h-[100dvh] items-start justify-center px-4 pb-32 pt-24 md:items-center md:py-28">
        <div className={`${panelClass} gc-rise overflow-hidden`}>
          <div className="grid gap-0 md:grid-cols-2">
            {/* LEFT: therapist + calendar */}
            <div className="border-b border-[#03392D]/[0.08] p-6 md:border-b-0 md:border-r md:p-8">
              <div className="flex items-center gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0b5a47] to-[#03392D] text-white">
                  <Stethoscope className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[17px] font-bold leading-tight text-[#10261E]">{copy.therapistName}</p>
                  <p className="text-[13px] text-[#52655B]">{copy.therapistRole}</p>
                  {programName ? (
                    <p className="mt-0.5 truncate text-[13px] font-medium text-[#2f5a12]">{programName}</p>
                  ) : null}
                </div>
              </div>

              {/* Month calendar */}
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={!canPrev}
                    onClick={() => setVisibleMonth((m) => addMonth(m, -1))}
                    aria-label={copy.prevMonth}
                    className="grid h-9 w-9 place-items-center rounded-full border border-[#03392D]/12 bg-white text-[#03392D] transition hover:bg-[#03392D]/[0.05] disabled:opacity-30"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden />
                  </button>
                  <p className="text-[15px] font-semibold text-[#10261E]">{monthTitle(visibleMonth, lang)}</p>
                  <button
                    type="button"
                    disabled={!canNext}
                    onClick={() => setVisibleMonth((m) => addMonth(m, 1))}
                    aria-label={copy.nextMonth}
                    className="grid h-9 w-9 place-items-center rounded-full border border-[#03392D]/12 bg-white text-[#03392D] transition hover:bg-[#03392D]/[0.05] disabled:opacity-30"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {copy.weekdays.map((wd) => (
                    <div key={wd} className="py-1 text-[12px] font-semibold text-[#52655B]">
                      {wd}
                    </div>
                  ))}
                  {grid.map((day, i) => {
                    if (!day) return <div key={`e-${i}`} aria-hidden />;
                    const key = toDateKey(day);
                    const info = monthMap.get(key);
                    const weekend = isWeekend(day);
                    const hasSlots = (info?.available ?? 0) > 0;
                    const selectable = hasSlots && !weekend;
                    const selected = selectedDay ? toDateKey(selectedDay) === key : false;
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!selectable}
                        aria-pressed={selected}
                        onClick={() => selectDay(day)}
                        className={`relative grid aspect-square place-items-center rounded-xl text-[14px] font-medium transition ${
                          selected
                            ? "bg-[#03392D] text-white"
                            : selectable
                              ? "text-[#18342A] hover:bg-[#03392D]/[0.07]"
                              : "cursor-not-allowed text-[#b7c7c0]"
                        }`}
                      >
                        {day.getDate()}
                        {selectable && !selected ? (
                          <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[#5a9a1f]" aria-hidden />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {monthLoading && !monthDays ? (
                  <p className="mt-3 text-center text-[13px] text-[#52655B]" aria-busy="true">
                    {copy.loading}
                  </p>
                ) : null}
              </div>

              {/* Time slots appear below the calendar once a day is chosen */}
              <div
                className={`grid transition-all duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${
                  selectedDay ? "mt-6 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
                aria-hidden={!selectedDay}
              >
                <div className="overflow-hidden">
                  <div className="border-t border-[#03392D]/[0.08] pt-6">
                    <TimeColumn
                      copy={copy}
                      selectedDay={selectedDay}
                      slots={slots}
                      slotsLoading={slotsLoading}
                      slotsError={slotsError}
                      selectedSlotId={selectedSlotId}
                      timezone={timezone}
                      conflictMessage={conflictMessage}
                      onSelectSlot={selectSlot}
                      onRetry={() => void refreshAvailabilityKeepingDay()}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: contact + consent + summary */}
            <div className="p-6 md:p-8">
              {/* Contact form + личный кабинет */}
              <div className="grid gap-3">
                <div>
                  <p className="text-[15px] font-semibold text-[#10261E]">{copy.contact}</p>
                  <p className="mt-1 text-[13px] leading-snug text-[#52655B]">{copy.contactHelper}</p>
                  {me ? (
                    <p className="mt-2 rounded-xl bg-[#8BC53F]/12 px-3 py-2 text-[13px] font-medium text-[#2f5a12]">
                      {copy.loggedInNote}
                    </p>
                  ) : null}
                </div>
                <label className="grid gap-1.5 text-[13px] font-medium text-[#52655B]" htmlFor="booking-name">
                  {copy.name}
                  <input
                    id="booking-name"
                    className={`h-12 w-full rounded-xl border bg-white px-4 text-[15px] text-[#18342A] outline-none transition placeholder:text-[#9fb2a9] focus:ring-4 focus:ring-[#03392D]/10 ${
                      nameError ? "border-[#b42318]/60 focus:border-[#b42318]/60" : "border-[#03392D]/12 focus:border-[#03392D]/50"
                    }`}
                    value={contactName}
                    onChange={(e) => {
                      setContactName(e.target.value);
                      if (nameError) setNameError(null);
                    }}
                    placeholder={copy.namePh}
                    autoComplete="name"
                    name="contact_name"
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "booking-name-error" : undefined}
                  />
                  {nameError ? (
                    <span id="booking-name-error" role="alert" className="text-[13px] font-medium text-[#b42318]">
                      {nameError}
                    </span>
                  ) : null}
                </label>
                <label className="grid gap-1.5 text-[13px] font-medium text-[#52655B]" htmlFor="booking-phone">
                  {copy.phone}
                  <input
                    id="booking-phone"
                    className={`h-12 w-full rounded-xl border bg-white px-4 text-[15px] tabular-nums text-[#18342A] outline-none transition placeholder:text-[#9fb2a9] focus:ring-4 focus:ring-[#03392D]/10 ${
                      phoneError ? "border-[#b42318]/60 focus:border-[#b42318]/60" : "border-[#03392D]/12 focus:border-[#03392D]/50"
                    }`}
                    value={phone}
                    onChange={(e) => {
                      setPhone(formatPhoneMask(e.target.value));
                      if (phoneError) setPhoneError(null);
                    }}
                    placeholder="+7 (___) ___-__-__"
                    autoComplete="tel"
                    name="phone"
                    inputMode="tel"
                    aria-invalid={Boolean(phoneError)}
                    aria-describedby={phoneError ? "booking-phone-error" : undefined}
                  />
                  {phoneError ? (
                    <span id="booking-phone-error" role="alert" className="text-[13px] font-medium text-[#b42318]">
                      {phoneError}
                    </span>
                  ) : null}
                </label>
              </div>

              {/* Required clinic-transfer consent stays with the contact form */}
              <div className="mt-4 grid gap-2">
                <SwitchRow
                  title={copy.consentTransferTitle}
                  body={copy.consentTransferBody}
                  required
                  checked={transferGranted}
                  onChange={onTransferChange}
                />
                {clinic ? (
                  <p className="px-1 text-[12px] text-[#52655B]">{copy.consentVersion(clinic.consent.transfer_text_version)}</p>
                ) : null}
              </div>

              {/* Summary + submit */}
              <div className="mt-5 rounded-2xl border border-[#03392D]/[0.09] bg-[#F4F8F5] p-4">
                <SummaryRow label={copy.summaryDate} value={selectedDay ? fmtLongDate(selectedDay, lang) : copy.notPicked} />
                <SummaryRow
                  label={copy.summaryTime}
                  value={selectedSlot ? formatSlotClock(selectedSlot.starts_at, timezone) : copy.notPicked}
                />
                <SummaryRow label={copy.summaryProgram} value={programName ?? copy.programFallback} />
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#52655B]">{copy.summaryPrice}</span>
                  <div className="text-right">
                    <PriceBlock
                      priceMinor={priceMinor}
                      priceOldMinor={priceOldMinor}
                      currency={priceCurrency}
                      lang={lang}
                      size="sm"
                    />
                  </div>
                </div>
                <div className="mt-3 border-t border-[#03392D]/[0.06] pt-3">
                  <SwitchRow
                    title={copy.consentReminderTitle}
                    body={copy.consentReminderBody}
                    checked={reminderGranted}
                    onChange={setReminderGranted}
                  />
                </div>
              </div>

              {submitError ? (
                <p className="mt-3 text-[14px] text-red-800" role="alert">
                  {submitError}
                </p>
              ) : null}

              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleBook()}
                className="group mt-4 hidden h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[#03392D] px-6 text-[17px] font-semibold leading-none text-white shadow-[0_12px_28px_rgba(3,57,45,.22)] transition hover:bg-[#02281f] active:scale-[0.98] disabled:opacity-45 md:flex"
              >
                <span className="truncate">{submitting ? copy.submitting : copy.submit}</span>
                <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
              </button>

              <p className="mt-4 hidden text-center text-[12px] text-[#52655B] md:block">{copy.footerNote}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky mobile summary + submit bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#03392D]/[0.08] bg-white/85 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#10261E]">
              {selectedDay ? fmtLongDate(selectedDay, lang) : copy.pickDay}
              {selectedSlot ? `, ${formatSlotClock(selectedSlot.starts_at, timezone)}` : ""}
            </p>
            <p className="truncate text-[12px] text-[#52655B]">{programName ?? copy.programFallback}</p>
          </div>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void handleBook()}
            className="inline-flex h-12 shrink-0 items-center rounded-full bg-[#03392D] px-6 text-[15px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-45"
          >
            {submitting ? copy.submitting : copy.submit}
          </button>
        </div>
      </div>
    </PatientShell>
  );
}

function TimeColumn({
  copy,
  selectedDay,
  slots,
  slotsLoading,
  slotsError,
  selectedSlotId,
  timezone,
  conflictMessage,
  onSelectSlot,
  onRetry,
}: {
  copy: BookingCopy;
  selectedDay: Date | null;
  slots: Slot[] | null;
  slotsLoading: boolean;
  slotsError: string | null;
  selectedSlotId: string | null;
  timezone: string;
  conflictMessage: string | null;
  onSelectSlot: (slot: Slot) => void;
  onRetry: () => void;
}) {
  const groups = useMemo(() => {
    const g: Record<"morning" | "afternoon" | "evening", Slot[]> = { morning: [], afternoon: [], evening: [] };
    (slots ?? []).forEach((s) => g[slotBucket(s.starts_at, timezone)].push(s));
    return g;
  }, [slots, timezone]);

  const groupLabels: Record<"morning" | "afternoon" | "evening", string> = {
    morning: copy.morning,
    afternoon: copy.afternoon,
    evening: copy.evening,
  };

  return (
    <div>
      <p className="text-[15px] font-semibold text-[#10261E]">{copy.time}</p>

      {!selectedDay ? (
        <p className="mt-3 text-[14px] text-[#52655B]">{copy.pickDayFirst}</p>
      ) : slotsLoading ? (
        <p className="mt-3 text-[14px] text-[#52655B]" aria-busy="true">
          {copy.loading}
        </p>
      ) : slotsError ? (
        <div className="mt-3 grid gap-3">
          <p className="text-[14px] text-red-800" role="alert">
            {slotsError}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="justify-self-start rounded-full border border-[#03392D]/12 bg-white px-4 py-2 text-[14px] font-semibold text-[#03392D] hover:bg-[#03392D]/[0.05]"
          >
            {copy.retry}
          </button>
        </div>
      ) : !slots || slots.length === 0 ? (
        <p className="mt-3 text-[14px] text-[#52655B]">{copy.noSlots}</p>
      ) : (
        <div className="mt-3 grid gap-4">
          {(["morning", "afternoon", "evening"] as const).map((bucket) =>
            groups[bucket].length ? (
              <div key={bucket}>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#52655B]">
                  {groupLabels[bucket]}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {groups[bucket].map((slot) => {
                    const busy = slot.availability === "busy";
                    const selected = slot.id === selectedSlotId;
                    const label = formatSlotClock(slot.starts_at, timezone);
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={busy}
                        aria-pressed={selected}
                        aria-label={busy ? `${label}, ${copy.busy}` : label}
                        onClick={() => onSelectSlot(slot)}
                        className={`h-11 rounded-xl border text-[14px] font-medium tabular-nums transition ${
                          selected
                            ? "border-[#03392D] bg-[#03392D] text-white"
                            : busy
                              ? "cursor-not-allowed border-[#03392D]/8 bg-[#03392D]/[0.03] text-[#b7c7c0] line-through"
                              : "border-[#03392D]/12 bg-white text-[#18342A] hover:border-[#03392D]/30 hover:bg-[#03392D]/[0.04]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
          {conflictMessage ? (
            <p className="text-[14px] text-red-800" role="alert">
              {conflictMessage}
            </p>
          ) : null}
        </div>
      )}
      {conflictMessage && (!slots || !slots.length) ? (
        <p className="mt-3 text-[14px] text-red-800" role="alert">
          {conflictMessage}
        </p>
      ) : null}
    </div>
  );
}

function SwitchRow({
  title,
  body,
  required = false,
  checked,
  onChange,
}: {
  title: string;
  body: string;
  required?: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 rounded-2xl border border-[#03392D]/[0.09] bg-white px-4 py-3 text-left transition hover:border-[#03392D]/20"
    >
      <span
        className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? "bg-[#03392D]" : "bg-[#03392D]/15"
        }`}
        aria-hidden
      >
        <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-[#10261E]">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[#52655B]">{body}</span>
      </span>
      {required ? (
        <span className="mt-0.5 shrink-0 rounded-full bg-[#8BC53F]/18 px-2 py-0.5 text-[11px] font-semibold text-[#2f5a12]">•</span>
      ) : null}
    </button>
  );
}

function SummaryRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${last ? "" : "border-b border-[#03392D]/[0.06]"}`}>
      <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#52655B]">{label}</span>
      <span className="text-right text-[14px] font-semibold tabular-nums text-[#10261E]">{value}</span>
    </div>
  );
}

function SuccessView({
  appointment,
  caseId,
  copy,
  lang,
  selectedDay,
  slot,
  timezone,
  onOpenCabinet,
  adopting,
  reminderConsented,
}: {
  appointment: Appointment;
  caseId: string | null;
  copy: BookingCopy;
  lang: UiLang;
  selectedDay: Date | null;
  slot: Slot | null;
  timezone: string;
  onOpenCabinet: () => void;
  adopting: boolean;
  reminderConsented: boolean;
}) {
  const pending = appointment.status === "clinic_request_pending";
  const canCalendar = appointment.status === "demo_confirmed" || appointment.status === "clinic_confirmed";

  const title = pending ? copy.successPending : copy.successConfirmed;
  const body = pending ? copy.bodyPending : copy.bodyConfirmed;

  const when =
    selectedDay && slot
      ? `${fmtLongDate(selectedDay, lang)}, ${formatSlotClock(slot.starts_at, timezone)}`
      : null;

  const checklist = [copy.checkAccount, copy.checkQuestionnaire, ...(reminderConsented ? [copy.checkReminder] : [])];

  return (
    <div className={`${panelClass} grid justify-items-center gap-5 p-8 text-center md:p-12`}>
      <span className="gc-check-pop grid h-20 w-20 place-items-center rounded-full bg-[#8BC53F]/20 text-[#2f5a12]">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[#03392D] text-white">
          <Check className="h-7 w-7" strokeWidth={3} aria-hidden />
        </span>
      </span>
      <div>
        <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#10261E] md:text-4xl">{title}</h1>
        {when ? <p className="mt-2 text-[17px] font-semibold text-[#03392D]">{when}</p> : null}
      </div>
      <p className="max-w-md text-[#52655B]">{body}</p>

      <ul className="grid w-full max-w-sm gap-2 text-left">
        {checklist.map((item) => (
          <li key={item} className="flex items-center gap-2.5 rounded-2xl bg-[#F4F8F5] px-4 py-2.5 text-[14px] text-[#18342A]">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#03392D] text-white">
              <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
            </span>
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-2 grid w-full max-w-sm gap-3">
        <button
          type="button"
          onClick={onOpenCabinet}
          disabled={adopting}
          className="group inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[#03392D] px-6 text-[17px] font-semibold leading-none text-white shadow-[0_12px_28px_rgba(3,57,45,.22)] transition hover:bg-[#02281f] active:scale-[0.98] disabled:opacity-60"
        >
          <span className="truncate">{copy.openCabinet}</span>
          <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </button>
        {canCalendar && caseId ? (
          <a
            href={`/api/cases/${caseId}/calendar.ics`}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#03392D]/12 bg-white px-6 text-[15px] font-semibold text-[#03392D] transition hover:bg-[#03392D]/[0.05]"
          >
            <CalendarPlus className="h-5 w-5" aria-hidden />
            {copy.addCalendar}
          </a>
        ) : null}
      </div>
      <p className="text-[12px] text-[#52655B]">{copy.footerNote}</p>
    </div>
  );
}
