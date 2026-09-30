import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LangSegment } from "@/components/patient/LangSegment";
import { ProfileButton } from "@/components/patient/ProfileButton";
import { useUiLang } from "@/features/patient-home/welcome";

/** Fixed glass top bar shared by the patient screens: logo · language · profile. */
export function PatientTopBar({ left, center }: { left?: ReactNode; center?: ReactNode }) {
  const lang = useUiLang();
  const homeAria = lang === "kz" ? "Green Clinic — басты бетке" : "Green Clinic — на главную";
  return (
    <header className="fixed inset-x-0 top-0 z-30 px-4 pt-4 md:px-8 md:pt-6">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 rounded-full border border-white/60 bg-white/55 pl-3 pr-2 shadow-[0_1px_2px_rgba(3,57,45,.05),0_8px_24px_rgba(3,57,45,.06)] backdrop-blur-xl md:pl-5">
        <div className="flex min-w-0 items-center gap-2">
          {left}
          <Link
            to="/"
            className="rounded-full px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#03392D]"
            aria-label={homeAria}
          >
            <img src="/prime-logo.svg" alt="PRIME Green Clinic" className="h-7 w-auto md:h-8" />
          </Link>
        </div>
        {center ? <div className="hidden min-w-0 flex-1 justify-center md:flex">{center}</div> : null}
        <div className="flex items-center gap-2">
          <LangSegment />
          <ProfileButton />
        </div>
      </div>
    </header>
  );
}

/** Soft "aurora" backdrop: base wash + four blurred colour fields drifting on independent paths. */
export function PatientBackdrop() {
  return (
    <div className="welcome-wash pointer-events-none fixed inset-0 -z-0 overflow-hidden" aria-hidden>
      <div className="gc-aurora gc-aurora-a" />
      <div className="gc-aurora gc-aurora-b" />
      <div className="gc-aurora gc-aurora-c" />
      <div className="gc-aurora gc-aurora-d" />
      <div className="gc-grain" />
    </div>
  );
}

/** Full-page patient shell: backdrop + top bar + scrollable content. */
export function PatientShell({
  children,
  topLeft,
  topCenter,
}: {
  children: ReactNode;
  topLeft?: ReactNode;
  topCenter?: ReactNode;
}) {
  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden text-[#18342A]" translate="no">
      <PatientBackdrop />
      <PatientTopBar left={topLeft} center={topCenter} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
