import type { ConsentReceipt, QuestionnaireSubmission } from "@/api/types";
import { getFlow } from "@/features/intake/flowState";

/** Navigation state from programs/intake → booking. All fields optional for anonymous preview. */
export type BookingLocationState = {
  selected_package_id?: string | null;
  packageId?: string | null;
  consultation_reason?: string | null;
  consultationReason?: string | null;
  preferred_date?: string | null;
  /** Human-readable program name to show on the therapist card. */
  program_name?: string | null;
  /** Program price in whole tenge (integer) or null when the clinic publishes none. */
  price_minor?: number | null;
  /** Higher "old" price to strike through when there is a discount. */
  price_old_minor?: number | null;
  currency?: string | null;
  /** Full questionnaire payload required before createCase/book. */
  submission?: QuestionnaireSubmission;
  processing_consent?: ConsentReceipt;
  revision_id?: string;
  /** camelCase alias used by some callers. */
  revisionId?: string;
  questionnaire_version?: string;
  answers?: Record<string, unknown>;
  doctor_note?: string | null;
};

export function resolveSubmission(state: BookingLocationState | null): QuestionnaireSubmission | null {
  if (!state) return null;
  if (state.submission) return state.submission;
  const revisionId = state.revision_id ?? state.revisionId;
  if (revisionId && state.questionnaire_version && state.processing_consent && state.answers) {
    return {
      contract_version: "v4",
      revision_id: revisionId,
      questionnaire_version: state.questionnaire_version,
      processing_consent: state.processing_consent,
      answers: state.answers,
      doctor_note: state.doctor_note ?? null,
    };
  }
  return getFlow()?.submission ?? null;
}
