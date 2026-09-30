import { useEffect } from "react";
import { ArrowRight, ShieldCheck, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { track } from "@/analytics/tracker";
import { usePatient } from "@/app/patientSession";
import { btnPrimaryArrow, btnPrimaryCentered, btnSecondary } from "@/components/patient/buttons";
import { openLogin } from "@/components/patient/loginSheetStore";
import { PatientShell } from "@/components/patient/PatientTopBar";
import { applyDocumentLang, setWelcomeProfile, useUiLang, welcomeCopy } from "@/features/patient-home/welcome";

export function HomePage() {
  const navigate = useNavigate();
  const lang = useUiLang();
  const copy = welcomeCopy[lang];
  const { me } = usePatient();

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  useEffect(() => {
    track("page_viewed", { screen_id: "home" });
  }, []);

  function startCheckup() {
    setWelcomeProfile({ name: me?.display_name ?? "", phone: me?.phone ?? "", lang });
    // push: browser "Back" from the quiz returns here.
    navigate("/intake");
  }

  function enterCabinet() {
    if (me) navigate("/cabinet");
    else openLogin("/cabinet");
  }

  return (
    <PatientShell>
      <main className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col items-center justify-center px-5 py-28 text-center md:px-8">
        <h1 className="gc-rise font-bold leading-[1.04] tracking-[-0.035em] text-[#10261E]">
          <span className="block text-[clamp(34px,6.5vw,64px)]">{copy.helloTop}</span>
          <span className="mt-1 block bg-gradient-to-r from-[#03392D] via-[#0b6b52] to-[#4f8f2c] bg-clip-text text-[clamp(30px,5.6vw,60px)] text-transparent sm:whitespace-nowrap">
            {copy.helloBottom}
          </span>
        </h1>

        <p className="gc-rise gc-d1 mt-6 max-w-md text-[17px] leading-relaxed text-[#52655B] md:text-lg">{copy.sub}</p>

        <div className="gc-rise gc-d2 mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
          <button type="button" className={`group ${btnPrimaryCentered} w-full sm:w-[300px]`} onClick={startCheckup}>
            <span>{copy.book}</span>
            <span className={btnPrimaryArrow}>
              <ArrowRight className="h-5 w-5" aria-hidden />
            </span>
          </button>
          <button type="button" className={`${btnSecondary} w-full justify-center sm:w-[300px]`} onClick={enterCabinet}>
            <UserRound className="h-5 w-5 text-[#03392D]/70" strokeWidth={1.8} aria-hidden />
            {me ? copy.cabinet : copy.login}
          </button>
        </div>
      </main>

      {/* Entry for the clinic side: opens the staff area (CRM). */}
      <footer className="fixed inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <Link
          to="/staff"
          className="gc-rise gc-d3 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/55 px-4 py-2 text-[13px] font-medium text-[#03392D]/75 backdrop-blur-xl transition hover:bg-white/80 hover:text-[#03392D]"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {copy.staff}
        </Link>
      </footer>
    </PatientShell>
  );
}
