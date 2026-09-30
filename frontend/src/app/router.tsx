import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { bootstrapPatientSession } from "@/app/patientSession";
import { LoginSheet } from "@/components/patient/LoginSheet";
import { BookingPage } from "@/features/booking/BookingPage";
import { CabinetPage } from "@/features/cabinet/CabinetPage";
import { IntakePage } from "@/features/intake/IntakePage";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { HomePage } from "@/features/patient-home/HomePage";
import { applyDocumentLang, getWelcomeProfile } from "@/features/patient-home/welcome";
import { ProgramsPage } from "@/features/recommendations/ProgramsPage";
import "@/components/patient/patient.css";

// Clinic workspace is loaded on demand: patients never download the dashboard code.
const StaffListPage = lazy(() => import("@/features/staff/StaffListPage").then((m) => ({ default: m.StaffListPage })));
const StaffCasePage = lazy(() => import("@/features/staff/StaffCasePage").then((m) => ({ default: m.StaffCasePage })));
const StaffSchedulePage = lazy(() => import("@/features/staff/StaffSchedulePage").then((m) => ({ default: m.StaffSchedulePage })));
const StaffFunnelPage = lazy(() => import("@/features/staff/StaffFunnelPage").then((m) => ({ default: m.StaffFunnelPage })));

function StaffFallback() {
  return <div className="min-h-[100dvh] bg-[#0F1412]" aria-busy="true" />;
}

export function AppRouter() {
  useEffect(() => {
    bootstrapPatientSession();
    applyDocumentLang(getWelcomeProfile().lang);
  }, []);

  return (
    <div>
      <main>
        <Suspense fallback={<StaffFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/booking" element={<BookingPage />} />
          <Route path="/cabinet" element={<CabinetPage />} />
          <Route path="/journey" element={<Navigate to="/cabinet" replace />} />
          <Route path="/health" element={<Navigate to="/cabinet?tab=results" replace />} />
          <Route path="/staff" element={<StaffListPage />} />
          <Route path="/staff/cases/:caseId" element={<StaffCasePage />} />
          <Route path="/staff/schedule" element={<StaffSchedulePage />} />
          <Route path="/staff/funnel" element={<StaffFunnelPage />} />
        </Routes>
        </Suspense>
      </main>
      <LoginSheet />
    </div>
  );
}
