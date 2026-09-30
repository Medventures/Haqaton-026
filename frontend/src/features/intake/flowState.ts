import type { Preview, QuestionnaireSubmission } from "@/api/types";
import { ApiClientError, api } from "@/api/client";

export type OverviewLocationState = {
  revisionId: string;
};

export type ProgramsLocationState = {
  preview: Preview;
};

export type BookingLocationState = {
  packageId: string;
  consultationReason: string;
  revisionId: string;
  selected_package_id?: string;
  consultation_reason?: string;
  revision_id?: string;
  program_name?: string | null;
  price_minor?: number | null;
  price_old_minor?: number | null;
  currency?: string | null;
  submission?: QuestionnaireSubmission;
};

export type PreviewStatus = "idle" | "pending" | "ready" | "error";

type FlowSnapshot = {
  revisionId: string;
  submission: QuestionnaireSubmission;
  consideredLabels: string[];
  status: PreviewStatus;
  preview: Preview | null;
  errorMessage: string | null;
  errorCode: string | null;
};

let current: FlowSnapshot | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeFlow(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFlow(): FlowSnapshot | null {
  return current;
}

export function clearFlow(): void {
  current = null;
  notify();
}

/** Start preview for a revision. Answers stay only in this module RAM. */
export function startPreviewFlow(input: {
  revisionId: string;
  submission: QuestionnaireSubmission;
  consideredLabels: string[];
}): void {
  const revisionId = input.revisionId;
  current = {
    revisionId,
    submission: input.submission,
    consideredLabels: input.consideredLabels,
    status: "pending",
    preview: null,
    errorMessage: null,
    errorCode: null,
  };
  notify();

  void api
    .preview(input.submission)
    .then((preview) => {
      if (!current || current.revisionId !== revisionId) return;
      current = {
        ...current,
        status: "ready",
        preview,
        errorMessage: null,
        errorCode: null,
      };
      notify();
    })
    .catch((err: unknown) => {
      if (!current || current.revisionId !== revisionId) return;
      const message =
        err instanceof ApiClientError ? err.message : "Не удалось получить предварительный подбор";
      const code = err instanceof ApiClientError ? err.code : "preview_failed";
      current = {
        ...current,
        status: "error",
        preview: null,
        errorMessage: message,
        errorCode: code,
      };
      notify();
    });
}

export function wipeMedicalFlow(): void {
  current = null;
  notify();
}
