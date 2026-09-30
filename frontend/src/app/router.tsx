import { useEffect } from "react";
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
import { StaffCasePage } from "@/features/staff/StaffCasePage";
import { StaffListPage } from "@/features/staff/StaffListPage";
import { StaffFunnelPage } from "@/features/staff/StaffFunnelPage";
import { StaffSchedulePage } from "@/features/staff/StaffSchedulePage";
import "@/components/patient/patient.css";

export function AppRouter() {
  useEffect(() => {
    bootstrapPatientSession();
    applyDocumentLang(getWelcomeProfile().lang);
  }, []);

  return (
    <div>
      <main>
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
      </main>
      <LoginSheet />
    </div>
  );
}
