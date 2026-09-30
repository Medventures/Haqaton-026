import { ApiClientError } from "@/api/client";
import type { UiLang } from "@/features/patient-home/welcome";

/** Pick the Kazakh program name when the UI is Kazakh, otherwise the Russian one. */
export function programName(
  ru: string | null | undefined,
  kz: string | null | undefined,
  lang: UiLang,
): string | null {
  const value = lang === "kz" ? kz ?? ru : ru;
  return value ?? null;
}

/**
 * Patient-facing copy for backend error codes. The API returns Russian messages;
 * in Kazakh we map by `err.code` to a Kazakh string, falling back to a generic line.
 * In Russian we keep the server message when present.
 */
const ERROR_COPY = {
  ru: {
    slot_conflict: "Это время уже заняли. Выберите другое.",
    phone_invalid: "Введите номер: +7 и 10 цифр",
    code_invalid: "Неверный код",
    code_expired: "Код устарел",
    otp_cooldown: "Слишком часто. Подождите немного",
    otp_limit: "Много запросов. Попробуйте позже",
    otp_attempts: "Слишком много попыток. Запросите новый код",
    patient_not_found: "Номер не найден",
    consent_required: "Нужно согласие на передачу в клинику",
    transfer_required: "Нужно согласие на передачу в клинику",
    contact_required: "Укажите имя и телефон",
    validation_error: "Проверьте введённые данные",
    generic: "Что-то пошло не так. Попробуйте ещё раз",
  },
  kz: {
    slot_conflict: "Бұл уақытты алып қойды. Басқасын таңдаңыз.",
    phone_invalid: "Нөмірді енгізіңіз: +7 және 10 сан",
    code_invalid: "Код қате",
    code_expired: "Кодтың мерзімі өтті",
    otp_cooldown: "Кодты қайта сұрау үшін біраз күтіңіз",
    otp_limit: "Сұраныс көп. Кейінірек көріңіз",
    otp_attempts: "Тым көп әрекет. Жаңа код сұраңыз",
    patient_not_found: "Нөмір табылмады",
    consent_required: "Клиникаға беруге келісім қажет",
    transfer_required: "Клиникаға беруге келісім қажет",
    contact_required: "Аты мен телефонды көрсетіңіз",
    validation_error: "Енгізілген деректерді тексеріңіз",
    generic: "Бірдеңе дұрыс болмады. Қайталап көріңіз",
  },
} as const;

type ErrorCode = keyof (typeof ERROR_COPY)["ru"];

/**
 * Localize an error thrown by the API client for display to the patient.
 * Kazakh: always map by code (server message is Russian and must not leak).
 * Russian: keep the server message when it exists, else a mapped/generic line.
 */
export function localizeApiError(err: unknown, lang: UiLang, fallback?: string): string {
  const table = ERROR_COPY[lang];
  if (err instanceof ApiClientError) {
    const code = err.code as ErrorCode;
    if (lang === "kz") return table[code] ?? fallback ?? table.generic;
    return err.message || table[code] || fallback || table.generic;
  }
  return fallback ?? table.generic;
}
