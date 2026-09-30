import { getActor } from "@/app/actor";
import type {
  Appointment,
  Funnel,
  HealthCard,
  AnalyticsOverview,
  DatabaseRow,
  OverviewCard,
  PatientLogin,
  PatientMe,
  Preview,
  QuestionnaireConfig,
  QuestionnaireSubmission,
  Slot,
  StaffCase,
  StaffPatientRow,
} from "@/api/types";

export class ApiClientError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string>;

  constructor(status: number, code: string, message: string, fieldErrors: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

async function request<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const actor = getActor();
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  if (actor.ownerSession) headers.set("X-Owner-Session", actor.ownerSession);
  if (actor.analyticsSessionId) headers.set("X-Analytics-Session", actor.analyticsSessionId);
  if (init?.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; field_errors?: Record<string, string> };
  };
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      payload.error?.code ?? "http_error",
      payload.error?.message ?? "Запрос не выполнен",
      payload.error?.field_errors ?? {},
    );
  }
  return payload as T;
}

export const api = {
  health: () => request<{ status: string; is_demo: boolean }>("/api/health"),
  questionnaire: () => request<QuestionnaireConfig>("/api/config/questionnaire"),
  clinic: () => request<{ timezone: string; therapist_id: string; is_demo: boolean; consent: { processing_copy: string; processing_text_version: string; transfer_text_version: string } }>("/api/config/clinic"),
  overviewCards: () => request<{ cards: OverviewCard[]; is_demo: boolean }>("/api/content/overview-cards"),
  preview: (body: QuestionnaireSubmission) => request<Preview>("/api/preview", { method: "POST", body: JSON.stringify(body) }),
  createCase: (body: Record<string, unknown>) =>
    request<{ case_id: string; owner_session: string; revision_id: string; state: string }>("/api/cases", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  availability: (therapistId: string, date: string) =>
    request<{ slots: Slot[]; therapist: { id: string; display_name: string; is_demo: boolean }; timezone: string }>(
      `/api/therapists/${therapistId}/availability?date=${encodeURIComponent(date)}`,
    ),
  availabilityMonth: (therapistId: string, month: string) =>
    request<{ month: string; timezone: string; days: Array<{ date: string; available: number; busy: number }>; is_demo: boolean }>(
      `/api/therapists/${therapistId}/availability/month?month=${encodeURIComponent(month)}`,
    ),
  book: (caseId: string, body: { slot_id: string; revision_id: string; consultation_reason: string }, idempotencyKey: string) =>
    request<Appointment>(`/api/cases/${caseId}/appointments`, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey,
    }),
  staffPatients: (query = "") => request<{ patients: StaffPatientRow[] }>(`/api/staff/patients${query}`),
  staffCase: (caseId: string) => request<StaffCase>(`/api/staff/cases/${caseId}`),
  patchStaffCase: (caseId: string, body: { notes?: string; owner_id?: string; preferred_date?: string | null }) =>
    request<StaffCase>(`/api/staff/cases/${caseId}`, { method: "PATCH", body: JSON.stringify(body) }),
  staffSchedule: (date: string) =>
    request<{ date: string; items: Array<{ slot_id: string; starts_at: string; ends_at: string; availability: string; case_id?: string | null }> }>(
      `/api/staff/schedule?date=${encodeURIComponent(date)}`,
    ),
  createPlan: (caseId: string, body: { revision_id: string; template_id: string }) =>
    request<Record<string, unknown>>(`/api/cases/${caseId}/physician-plan`, { method: "POST", body: JSON.stringify(body) }),
  createRoute: (caseId: string) => request<Record<string, unknown>>(`/api/cases/${caseId}/route`, { method: "POST" }),
  preparation: (caseId: string) => request<Record<string, unknown>>(`/api/cases/${caseId}/preparation`),
  healthCard: (caseId: string) => request<HealthCard>(`/api/cases/${caseId}/health-card`),
  reviewResults: (caseId: string, body: { revision_id: string }) =>
    request<Record<string, unknown>>(`/api/cases/${caseId}/results-review`, { method: "POST", body: JSON.stringify(body) }),
  patchTask: (taskId: string, body: { status: "active" | "completed" | "superseded" }) =>
    request<Record<string, unknown>>(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }),
  staffDatabase: () => request<{ rows: DatabaseRow[]; medical_columns: boolean; total: number }>("/api/staff/database"),
  analyticsOverview: () => request<AnalyticsOverview>("/api/staff/analytics/overview"),
  funnel: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("date_from", from);
    if (to) params.set("date_to", to);
    const q = params.toString();
    return request<Funnel>(`/api/staff/analytics/funnel${q ? `?${q}` : ""}`);
  },
  demoSession: (role: "patient" | "coordinator" | "doctor" | "admin", patientId?: string) =>
    request<{ token: string; role: string; display_name: string; is_demo: boolean }>("/api/demo/session", {
      method: "POST",
      body: JSON.stringify({ role, patient_id: patientId ?? null }),
    }),
  track: (events: Array<Record<string, unknown>>) =>
    request<{ accepted: string[]; rejected: unknown[] }>("/api/analytics/events", {
      method: "POST",
      body: JSON.stringify({ events }),
    }),
  patientLogin: (phone: string, code: string) =>
    request<PatientLogin>("/api/patient/login", { method: "POST", body: JSON.stringify({ phone, code }) }),
  otpRequest: (phone: string) =>
    request<{ sent: boolean; retry_after: number; expires_in: number }>("/api/patient/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  otpVerify: (phone: string, code: string) =>
    request<PatientLogin>("/api/patient/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) }),
  patientLastRequest: () =>
    request<{
      answers: Record<string, unknown>;
      doctor_note: string | null;
      package_id: string | null;
      program_name: string | null;
      price_minor: number | null;
      price_old_minor: number | null;
      consultation_reason: string;
    }>("/api/patient/last-request"),
  patientMe: () => request<PatientMe>("/api/patient/me"),
  patientLogout: () => request<{ ok: boolean }>("/api/patient/logout", { method: "POST" }),
};
