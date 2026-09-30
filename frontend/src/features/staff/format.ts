import { format, parseISO, isValid } from "date-fns";

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const parsed = parseISO(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (!isValid(parsed)) return value;
    return format(parsed, "dd.MM.yyyy");
  } catch {
    return value;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const parsed = parseISO(value);
    if (!isValid(parsed)) return value;
    return format(parsed, "dd.MM.yyyy HH:mm");
  } catch {
    return value;
  }
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const parsed = parseISO(value);
    if (!isValid(parsed)) return value;
    return format(parsed, "HH:mm");
  } catch {
    return value;
  }
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "нет данных";
  return `${(rate * 100).toFixed(1)}%`;
}

export function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

/** Human RU labels for every pipeline stage. */
export const STAGE_LABELS: Record<string, string> = {
  questionnaire_saved: "Анкета",
  package_selected: "Программа выбрана",
  therapist_booking_requested: "Заявка на приём",
  therapist_booking_confirmed: "Записан к терапевту",
  consultation_completed: "Приём прошёл",
  physician_plan_confirmed: "План врача",
  preparation_in_progress: "Подготовка",
  results_available: "Результаты",
  results_reviewed: "Результаты разобраны",
  follow_up_planned: "Повторы",
};

/** Compact labels used in the sidebar recent list. */
export const STAGE_SHORT_LABELS: Record<string, string> = {
  questionnaire_saved: "Анкета",
  package_selected: "Программа",
  therapist_booking_requested: "Заявка",
  therapist_booking_confirmed: "Записан",
  consultation_completed: "Приём прошёл",
  physician_plan_confirmed: "План врача",
  preparation_in_progress: "Подготовка",
  results_available: "Результаты",
  results_reviewed: "Разобрано",
  follow_up_planned: "Повторы",
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  return STAGE_LABELS[stage] ?? stage;
}

export function stageShortLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  return STAGE_SHORT_LABELS[stage] ?? STAGE_LABELS[stage] ?? stage;
}

/** Sidebar dot colour: amber when a human action is expected, green when booked/confirmed. */
export function stageDot(stage: string | null | undefined): "green" | "amber" | "grey" {
  switch (stage) {
    case "consultation_completed":
    case "results_available":
      return "amber";
    case "therapist_booking_confirmed":
    case "physician_plan_confirmed":
    case "follow_up_planned":
      return "green";
    default:
      return "grey";
  }
}

/** Human labels for next-action codes. */
export const NEXT_ACTION_LABELS: Record<string, string> = {
  select_programme: "Выбрать программу",
  book_therapist: "Записать к терапевту",
  await_clinic_confirmation: "Ждём подтверждения клиники",
  await_consultation: "Ждём приёма",
  create_physician_plan: "Утвердить план врача",
  build_route: "Построить маршрут",
  complete_preparation: "Завершить подготовку",
  review_results: "Разобрать результаты",
  complete_follow_up: "Закрыть повторы",
  review_case: "Проверить карточку",
};

export function nextActionLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return NEXT_ACTION_LABELS[code] ?? code;
}

/** Program id → human RU name. demo-* collapses to a discussion label. */
export const PROGRAM_LABELS: Record<string, string> = {
  "w-basic-u40": "Женский базовый до 40",
  "m-basic-u40": "Мужской базовый до 40",
  "w-extended-40p": "Женский расширенный 40+",
  "m-extended-40p": "Мужской расширенный 40+",
  "kids-1-17": "Детский 1–17",
};

export function programLabel(id: string | null | undefined): string {
  if (!id) return "—";
  if (PROGRAM_LABELS[id]) return PROGRAM_LABELS[id];
  if (id.startsWith("demo-")) return "Программа к обсуждению";
  return id;
}

/** Initials for an avatar circle. */
export function initials(name: string | null | undefined): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "•";
}

/** Appointment status → short RU. */
export function appointmentStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "demo_confirmed":
      return "Подтверждена";
    case "clinic_request_pending":
      return "Заявка в клинику";
    case "clinic_confirmed":
      return "Подтверждён клиникой";
    case "cancelled":
      return "Отменён";
    default:
      return status && status.trim() ? status : "—";
  }
}
