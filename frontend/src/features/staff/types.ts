import type { HealthCard, StaffCase } from "@/api/types";

export type TimelineEvent = {
  id?: string;
  at: string;
  actor: string;
  action: string;
  payload?: Record<string, unknown>;
};

export type StaffCaseDetail = StaffCase & {
  current_revision_id?: string | null;
  revision_id?: string | null;
  requested_changes?: string[] | null;
  requested_services?: string[] | null;
  plan?: {
    id: string;
    template_id?: string | null;
    status?: string | null;
    services?: string[] | null;
    approval_status?: string | null;
    mode?: string | null;
    approved_at?: string | null;
  } | null;
  route?: {
    feasible?: boolean;
    outcome?: string | null;
    items?: Array<{
      id: string;
      procedure_code: string;
      starts_at?: string | null;
      ends_at?: string | null;
      resource?: string | null;
      feasible?: boolean;
      outcome?: string | null;
    }>;
  } | null;
  reports?: HealthCard["reports"];
  tasks?: HealthCard["tasks"];
  timeline?: TimelineEvent[];
  events?: TimelineEvent[];
};

export function caseRevisionId(detail: StaffCaseDetail): string | null {
  return detail.current_revision_id ?? detail.revision_id ?? null;
}
