export type WorkflowClass =
  | "standard_preview"
  | "needs_clinician_review"
  | "pregnancy_review"
  | "adult_scope_excluded"
  | "safety_stop"
  | "catalogue_only";

export type Eligibility = "eligible" | "needs_review" | "ineligible";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    field_errors: Record<string, string>;
    request_id: string;
  };
};

export type ConsentReceipt = { granted: boolean; text_version: string };

export type QuestionnaireSubmission = {
  contract_version: "v4";
  revision_id: string;
  questionnaire_version: string;
  processing_consent: ConsentReceipt;
  answers: Record<string, unknown>;
  doctor_note?: string | null;
};

export type Reason = {
  code: string;
  input_refs: string[];
  template_id: string;
  source_refs: string[];
  rule_id?: string | null;
  rule_version?: string | null;
  text_ru?: string | null;
  text_kz?: string | null;
};

export type PackageCandidate = {
  package_id: string;
  name: string;
  composition_status: "complete" | "incomplete" | "unknown";
  known_services: string[];
  missing_positions: string[];
  unknown_positions: string[];
  price_minor: number | null;
  currency: string | null;
  reasons: Reason[];
  eligibility: Eligibility;
  review_flags: string[];
};

export type Explanation = {
  id: string;
  title_ru: string;
  text_ru: string;
  title_kz: string | null;
  text_kz: string | null;
  blocks: string[];
  tier: "optimal" | "maximum" | null;
};

export type OfferTier = {
  slot: "optimal" | "maximum";
  package_id: string;
  name: string;
  variant: "standard" | "adapted";
  block_ids: string[];
  extra_block_ids: string[];
  price_minor: number | null;
  currency: string | null;
  source_url: string | null;
  note_ru: string | null;
  note_kz: string | null;
  adaptation_ru: string[];
  adaptation_kz: string[];
  details: Array<{ id: string; label: string }>;
  price_old_minor: number | null;
};

export type ComparisonRow = { block_id: string; label_ru: string; label_kz: string; optimal: boolean; maximum: boolean };

export type TierGroup = { sex: "female" | "male"; optimal: OfferTier; maximum: OfferTier; comparison: ComparisonRow[] };

export type Offer = {
  groups: TierGroup[];
  recommended: "optimal" | "maximum" | null;
  recommendation_ru: string;
  recommendation_kz: string;
  cta: "book" | "discuss";
  explanations: Explanation[];
  factors: string[];
  rules_version: string;
};

export type Preview = {
  contract_version: string;
  revision_id: string;
  mode: "anonymous" | "saved";
  workflow_class: WorkflowClass;
  candidates: PackageCandidate[];
  offer: Offer | null;
  explanations: Explanation[];
  review_flags: string[];
  questions_for_doctor: string[];
  is_demo: boolean;
  questionnaire_version: string;
  catalogue_version: string;
  rules_version: string;
  state: string;
};

export type OverviewCard = {
  id: string;
  interval_index: number;
  title: string;
  text: string;
  source_label: string;
  source_url: string;
  population: string;
};

export type Slot = {
  id: string;
  therapist_id: string;
  starts_at: string;
  ends_at: string;
  availability: "available" | "busy";
};

export type Appointment = {
  id: string;
  case_id: string;
  slot_id: string;
  status: "demo_confirmed" | "clinic_request_pending" | "clinic_confirmed" | "cancelled";
  is_demo: boolean;
};

export type StaffPatientRow = {
  patient_id: string;
  case_id: string;
  display_name: string;
  stage: string;
  selected_program_id: string | null;
  preferred_date: string | null;
  booked_starts_at: string | null;
  appointment_status: string | null;
  next_action: string;
  is_demo: boolean;
};

export type StaffCase = StaffPatientRow & {
  notes: string | null;
  owner_id: string | null;
  phone: string | null;
  contact_name: string | null;
  questionnaire?: {
    answers: Record<string, unknown>;
    doctor_note: string | null;
    active_fields: string[];
  } | null;
};

export type HealthCard = {
  case_id: string;
  is_demo: boolean;
  reports: Array<{
    id: string;
    title: string;
    observed_on: string | null;
    original_text: string | null;
    review_status: string;
    observations: Array<{
      id: string;
      name: string;
      value: string | null;
      unit: string | null;
      reference_range: string | null;
      assertion: string;
      source_span: string | null;
    }>;
  }>;
  tasks: Array<{ id: string; kind: string; action: string; due_at: string | null; status: string }>;
};

export type Funnel = {
  from: string | null;
  to: string | null;
  unit: "sessions";
  counts: Record<string, number>;
  rates: Record<string, number | null>;
  is_demo: boolean;
};

export type QuestionOption = { code: string; label: string; label_kz?: string };
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { id: string; eq?: string | number; in?: string[]; lte?: number; gte?: number; lt?: number; gt?: number; exists?: boolean };
export type QuestionDef = {
  id: string;
  block: string;
  answer_type: "number" | "single" | "multi";
  label: string;
  label_kz?: string;
  required?: boolean;
  exclusive?: string[];
  options?: QuestionOption[];
  show_if?: Condition;
  required_if?: Condition;
  validation?: { min: number; max: number };
};

export type QuestionnaireConfig = {
  questionnaire_version: string;
  mode: string;
  blocks: string[];
  doctor_note: { max_length: number; label: string; label_kz?: string };
  questions: QuestionDef[];
};

export type PatientLogin = {
  role: "patient" | "admin";
  token: string;
  patient_id: string | null;
  display_name: string;
  language: string;
  is_demo: boolean;
};

export type PatientCaseSummary = {
  case_id: string;
  stage: string;
  step_index: number;
  selected_program_id: string | null;
  selected_program_name: string | null;
  consultation_reason: string | null;
  preferred_date: string | null;
  booked_starts_at: string | null;
  appointment_status: string | null;
  next_action: string;
  is_demo: boolean;
};

export type PatientMe = {
  patient_id: string;
  display_name: string;
  phone: string | null;
  language: string;
  journey_steps: string[];
  cases: PatientCaseSummary[];
  is_demo: boolean;
};

export type CountItem = { key?: string; id?: string; stage?: string; package_id?: string; label?: string; name?: string; count: number };

export type QuestionStat = {
  id: string;
  label: string;
  type: "number" | "single" | "multi";
  respondents: number;
  views: number;
  answered: number;
  drop_off: number | null;
  options: Array<{ code: string; label: string; count: number; share: number | null }>;
};

export type AnalyticsOverview = {
  generated_at: string;
  kpis: {
    clients: number;
    sessions: number;
    completion_rate: number | null;
    booking_rate: number | null;
    visit_conversion: number | null;
    appointments: number;
    pending_requests: number;
    upcoming_7d: number;
    utilisation_14d: number | null;
    avg_age: number | null;
    maximum_share: number | null;
  };
  funnel: Array<{ key: string; label: string; count: number }>;
  stages: Array<{ stage: string; label: string; count: number }>;
  programs: Array<{ package_id: string; name: string; count: number }>;
  tiers: Array<{ key: string; label: string; count: number }>;
  factors: Array<{ id: string; label: string; count: number }>;
  sex: Array<{ key: string; label: string; count: number }>;
  age_groups: Array<{ label: string; count: number }>;
  bookings_by_day: Array<{ date: string; count: number }>;
  questions: QuestionStat[];
  note: string;
  is_demo: boolean;
};
