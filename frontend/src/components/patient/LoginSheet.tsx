import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, ChevronLeft, Loader2, Smartphone, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiClientError } from "@/api/client";
import { requestOtp, verifyOtp } from "@/app/patientSession";
import {
  btnGhost,
  btnPrimary,
  btnSecondary,
  fieldBase,
  iconBtn,
} from "@/components/patient/buttons";
import { closeLogin, useLoginSheet } from "@/components/patient/loginSheetStore";
import { welcomeCopy, useUiLang } from "@/features/patient-home/welcome";

const CODE_LEN = 4;
const RESEND_SECONDS = 59;

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Format digits after +7 as "+7 (700) 000-00-05". */
function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("8") || digits.startsWith("7")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 8);
  const d = digits.slice(8, 10);
  let out = "+7";
  if (a) out += ` (${a}${a.length === 3 ? ")" : ""}`;
  if (b) out += ` ${b}`;
  if (c) out += `-${c}`;
  if (d) out += `-${d}`;
  return out;
}

function phoneDigits(formatted: string): string {
  return formatted.replace(/\D/g, "").slice(1);
}

export function LoginSheet() {
  const { open, redirectTo } = useLoginSheet();
  if (!open) return null;
  return <LoginDialog redirectTo={redirectTo} />;
}

function LoginDialog({ redirectTo }: { redirectTo: string | null }) {
  const lang = useUiLang();
  const copy = welcomeCopy[lang];
  const navigate = useNavigate();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+7");
  const [code, setCode] = useState<string[]>(Array(CODE_LEN).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    phoneRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    };
  }, []);

  useEffect(() => {
    if (step === "code") codeRefs.current[0]?.focus();
    if (step === "phone") phoneRef.current?.focus();
  }, [step]);

  // Resend countdown while on the code step.
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeLogin();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const phoneReady = phoneDigits(phone).length === 10;
  const codeValue = code.join("");
  const fullPhone = `+7${phoneDigits(phone)}`;

  async function sendCode(): Promise<boolean> {
    if (!phoneReady) {
      setError(copy.errPhone);
      return false;
    }
    setSending(true);
    setError(null);
    setNotFound(false);
    try {
      const { retryAfter } = await requestOtp(fullPhone);
      setCountdown(retryAfter && retryAfter > 0 ? retryAfter : RESEND_SECONDS);
      return true;
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "phone_invalid") setError(copy.errPhone);
        else if (err.code === "otp_cooldown") setError(lang === "kz" ? copy.errCooldown : err.message || copy.errCooldown);
        else if (err.code === "otp_limit") setError(lang === "kz" ? copy.errLimit : err.message || copy.errLimit);
        else setError(lang === "kz" ? copy.errGeneric : err.message || copy.errGeneric);
      } else {
        setError(copy.errGeneric);
      }
      return false;
    } finally {
      setSending(false);
    }
  }

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    const ok = await sendCode();
    if (ok) {
      setCode(Array(CODE_LEN).fill(""));
      setStep("code");
    }
  }

  async function resendCode() {
    if (countdown > 0 || sending) return;
    setCode(Array(CODE_LEN).fill(""));
    await sendCode();
    codeRefs.current[0]?.focus();
  }

  async function submitCode(value = codeValue) {
    if (value.length !== CODE_LEN || busy) return;
    setBusy(true);
    setError(null);
    setNotFound(false);
    try {
      const result = await verifyOtp(fullPhone, value);
      closeLogin();
      if (result.role === "admin") {
        navigate("/staff");
      } else if (redirectTo) {
        navigate(redirectTo);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "code_invalid") setError(copy.errCode);
        else if (err.code === "code_expired") setError(copy.errCodeExpired);
        else if (err.code === "otp_attempts") setError(copy.errAttempts);
        else if (err.code === "patient_not_found") {
          setError(copy.errNotFound);
          setNotFound(true);
        } else if (err.code === "phone_invalid") {
          setError(copy.errPhone);
          setStep("phone");
        } else {
          setError(lang === "kz" ? copy.errGeneric : err.message || copy.errGeneric);
        }
      } else {
        setError(copy.errGeneric);
      }
      setCode(Array(CODE_LEN).fill(""));
      codeRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setDigit(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setCode((prev) => prev.map((d, i) => (i === index ? "" : d)));
      return;
    }
    const next = [...code];
    // Supports paste of the full code into any cell.
    for (let i = 0; i < digits.length && index + i < CODE_LEN; i += 1) next[index + i] = digits[i]!;
    setCode(next);
    const nextIndex = Math.min(index + digits.length, CODE_LEN - 1);
    codeRefs.current[nextIndex]?.focus();
    const joined = next.join("");
    if (joined.length === CODE_LEN) void submitCode(joined);
  }

  function onCodeKey(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !code[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) codeRefs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < CODE_LEN - 1) codeRefs.current[index + 1]?.focus();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" onKeyDown={onKeyDown} translate="no">
      <button
        type="button"
        aria-label={copy.close}
        tabIndex={-1}
        className="gc-backdrop absolute inset-0 bg-[#18342A]/30 backdrop-blur-[6px]"
        onClick={() => closeLogin()}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        className="gc-sheet relative w-full max-w-md rounded-t-[32px] border border-white/70 bg-white/95 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_40px_rgba(3,57,45,.18)] backdrop-blur-2xl md:rounded-[32px] md:px-8 md:pb-8 md:pt-6 md:shadow-[0_24px_64px_rgba(3,57,45,.22)]"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#03392D]/15 md:hidden" aria-hidden />
        <div className="flex items-center justify-between">
          {step === "code" ? (
            <button
              type="button"
              className={iconBtn}
              aria-label={copy.changePhone}
              onClick={() => {
                setStep("phone");
                setError(null);
                setNotFound(false);
              }}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#03392D]/[0.06] text-[#03392D]">
              <Smartphone className="h-5 w-5" strokeWidth={1.8} aria-hidden />
            </span>
          )}
          <button type="button" className={iconBtn} aria-label={copy.close} onClick={() => closeLogin()}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {step === "phone" ? (
          <form className="mt-5 grid gap-5" onSubmit={submitPhone} noValidate>
            <div>
              <h2 id="login-title" className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-[#18342A]">
                {copy.loginTitle}
              </h2>
              <p className="mt-2 text-[15px] text-[#52655B]">{copy.loginSub}</p>
            </div>
            <label className="grid gap-2 text-sm font-medium text-[#52655B]" htmlFor="login-phone">
              {copy.phone}
              <input
                ref={phoneRef}
                id="login-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhone(e.target.value));
                  setError(null);
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
                className={`${fieldBase} text-xl tabular-nums tracking-wide`}
                placeholder="+7 (700) 000-00-00"
              />
            </label>
            {error ? (
              <p id="login-error" role="alert" className="-mt-2 text-sm font-medium text-[#b42318]">
                {error}
              </p>
            ) : null}
            <button type="submit" className={`group ${btnPrimary} w-full`} disabled={!phoneReady || sending}>
              <span className="truncate">{copy.getCode}</span>
              {sending ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
              )}
            </button>
          </form>
        ) : (
          <form
            className="mt-5 grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode();
            }}
          >
            <div>
              <h2 id="login-title" className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-[#18342A]">
                {copy.codeTitle}
              </h2>
              <p className="mt-2 text-[15px] text-[#52655B]">{copy.codeSub(phone)}</p>
            </div>
            <div className="flex justify-between gap-3" role="group" aria-label={copy.codeTitle}>
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    codeRefs.current[index] = el;
                  }}
                  value={digit}
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={CODE_LEN}
                  aria-label={`${index + 1}`}
                  aria-invalid={Boolean(error)}
                  onChange={(e) => setDigit(index, e.target.value)}
                  onKeyDown={(e) => onCodeKey(index, e)}
                  onFocus={(e) => e.target.select()}
                  className={`h-16 w-full rounded-2xl border bg-white text-center text-3xl font-bold tabular-nums text-[#18342A] outline-none transition focus:border-[#03392D]/60 focus:ring-4 focus:ring-[#03392D]/10 ${
                    error ? "border-[#b42318]/50" : "border-[#03392D]/12"
                  }`}
                />
              ))}
            </div>
            {error ? (
              <div className="-mt-2 grid gap-3">
                <p role="alert" className="text-sm font-medium text-[#b42318]">
                  {error}
                </p>
                {notFound ? (
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => {
                      closeLogin();
                      navigate("/intake");
                    }}
                  >
                    {copy.toIntake}
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              type="submit"
              className={`group ${btnPrimary} w-full`}
              disabled={codeValue.length !== CODE_LEN || busy}
            >
              <span className="truncate">{copy.enter}</span>
              {busy ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <ArrowRight className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
              )}
            </button>
            <div className="-mt-1 flex flex-col items-center gap-1">
              {countdown > 0 ? (
                <p className="text-[13px] tabular-nums text-[#52655B]" aria-live="polite">
                  {copy.resendIn(mmss(countdown))}
                </p>
              ) : (
                <button
                  type="button"
                  className="text-[14px] font-semibold text-[#03392D] underline-offset-2 hover:underline disabled:opacity-45"
                  disabled={sending}
                  onClick={() => void resendCode()}
                >
                  {copy.resend}
                </button>
              )}
              <button
                type="button"
                className={`${btnGhost}`}
                onClick={() => {
                  setStep("phone");
                  setError(null);
                  setNotFound(false);
                }}
              >
                {copy.changePhone}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
