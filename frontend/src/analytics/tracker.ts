import { api } from "@/api/client";
import { setAnalyticsSessionId } from "@/app/actor";
import { createId } from "@/lib/id";

const STORAGE_KEY = "analytics_session_id";
const ALLOWED = new Set([
  "session_started",
  "page_viewed",
  "intake_started",
  "intake_step_viewed",
  "intake_step_completed",
  "intake_submitted",
  "overview_started",
  "overview_completed",
  "recommendations_viewed",
  "cta_clicked",
  "booking_opened",
  "slot_selected",
  "clinic_transfer_consented",
  "technical_error",
  "question_viewed",
  "question_answered",
]);

let queue: Array<Record<string, unknown>> = [];
let flushed = false;

export function analyticsSessionId(): string {
  const existing = sessionStorage.getItem(STORAGE_KEY);
  if (existing) {
    setAnalyticsSessionId(existing);
    return existing;
  }
  const created = createId();
  sessionStorage.setItem(STORAGE_KEY, created);
  setAnalyticsSessionId(created);
  return created;
}

export function track(name: string, props: Record<string, string | number | boolean> = {}) {
  if (!ALLOWED.has(name)) return;
  const event = {
    event_id: createId(),
    analytics_session_id: analyticsSessionId(),
    name,
    occurred_at: new Date().toISOString(),
    props,
  };
  queue.push(event);
  if (queue.length >= 6) void flush();
}

export async function flush() {
  if (!queue.length || flushed) return;
  const batch = queue.splice(0, 20);
  try {
    await api.track(batch);
  } catch {
    queue = [];
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    flushed = true;
    if (!queue.length) return;
    const body = JSON.stringify({ events: queue.splice(0, 20) });
    navigator.sendBeacon("/api/analytics/events", new Blob([body], { type: "application/json" }));
  });
}
