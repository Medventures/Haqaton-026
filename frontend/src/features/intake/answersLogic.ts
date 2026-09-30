import type { Condition, QuestionDef, QuestionnaireConfig } from "@/api/types";

export type AnswerValue = string | number | string[];
export type Answers = Record<string, AnswerValue>;

export const INTAKE_BLOCK_IDS = ["about", "wellbeing", "history", "results", "review"] as const;
export type IntakeBlockId = (typeof INTAKE_BLOCK_IDS)[number];

export const BLOCK_TITLES: Record<IntakeBlockId, string> = {
  about: "О вас и цели",
  wellbeing: "Самочувствие",
  history: "Что учесть",
  results: "История обследований",
  review: "Проверка ответов",
};

/** Mirrors backend/app/conditions.py: eq / in / lte / gte / lt / gt / exists, all / any / not. */
export function conditionMet(condition: Condition | undefined, answers: Answers): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((c) => conditionMet(c, answers));
  if ("any" in condition) return condition.any.some((c) => conditionMet(c, answers));
  if ("not" in condition) return !conditionMet(condition.not, answers);
  const value = answers[condition.id];
  if (condition.eq !== undefined) return value === condition.eq;
  if (condition.in) {
    if (Array.isArray(value)) return value.some((v) => condition.in!.includes(v));
    return typeof value === "string" && condition.in.includes(value);
  }
  if (condition.exists !== undefined) {
    const present = value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
    return condition.exists ? present : !present;
  }
  const num = typeof value === "number" ? value : undefined;
  if (condition.lte !== undefined) return num !== undefined && num <= condition.lte;
  if (condition.gte !== undefined) return num !== undefined && num >= condition.gte;
  if (condition.lt !== undefined) return num !== undefined && num < condition.lt;
  if (condition.gt !== undefined) return num !== undefined && num > condition.gt;
  return false;
}

export function isVisible(question: QuestionDef, answers: Answers): boolean {
  if (!question.show_if) return true;
  return conditionMet(question.show_if, answers);
}

export function isRequired(question: QuestionDef, answers: Answers): boolean {
  if (!isVisible(question, answers)) return false;
  if (question.required) return true;
  if (question.required_if) return conditionMet(question.required_if, answers);
  return false;
}

/** Active answers for submit/review: hidden fields excluded. Unknown stays distinct from no. */
export function projectActiveAnswers(config: QuestionnaireConfig, answers: Answers): Answers {
  const active: Answers = {};
  for (const question of config.questions) {
    if (!isVisible(question, answers)) continue;
    if (answers[question.id] === undefined) continue;
    active[question.id] = answers[question.id];
  }
  return active;
}

export function applyExclusiveMulti(
  question: QuestionDef,
  current: string[] | undefined,
  toggledCode: string,
): string[] {
  const exclusive = new Set(question.exclusive ?? []);
  const selected = new Set(current ?? []);
  if (selected.has(toggledCode)) {
    selected.delete(toggledCode);
    return [...selected];
  }
  if (exclusive.has(toggledCode)) {
    return [toggledCode];
  }
  for (const code of exclusive) selected.delete(code);
  selected.add(toggledCode);
  return [...selected];
}

export function validateBlock(
  config: QuestionnaireConfig,
  block: string,
  answers: Answers,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const active = projectActiveAnswers(config, answers);
  for (const question of config.questions) {
    if (question.block !== block) continue;
    if (!isVisible(question, answers)) continue;
    const value = active[question.id];
    const required = isRequired(question, answers);
    if (value === undefined || value === "") {
      if (required) errors[question.id] = "Укажите ответ";
      continue;
    }
    if (question.answer_type === "number") {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num) || !Number.isInteger(num)) {
        errors[question.id] = "Введите целое число";
        continue;
      }
      const min = question.validation?.min;
      const max = question.validation?.max;
      if (min !== undefined && num < min) errors[question.id] = `Минимум ${min}`;
      if (max !== undefined && num > max) errors[question.id] = `Максимум ${max}`;
    }
    if (question.answer_type === "multi") {
      if (!Array.isArray(value) || value.length === 0) {
        if (required) errors[question.id] = "Укажите ответ";
      }
    }
  }
  return errors;
}

export function validateAllVisible(config: QuestionnaireConfig, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const block of ["about", "wellbeing", "history", "results"]) {
    Object.assign(errors, validateBlock(config, block, answers));
  }
  return errors;
}

export function optionLabel(question: QuestionDef, code: string): string {
  return question.options?.find((o) => o.code === code)?.label ?? code;
}

export function formatAnswer(question: QuestionDef, value: AnswerValue): string {
  if (question.answer_type === "number") return String(value);
  if (question.answer_type === "single" && typeof value === "string") {
    return optionLabel(question, value);
  }
  if (question.answer_type === "multi" && Array.isArray(value)) {
    return value.map((code) => optionLabel(question, code)).join(", ");
  }
  return String(value);
}

export function consideredLabels(config: QuestionnaireConfig, answers: Answers): string[] {
  const active = projectActiveAnswers(config, answers);
  return config.questions
    .filter((q) => active[q.id] !== undefined)
    .map((q) => q.label);
}

/** Swap question / option / note labels to Kazakh when available (codes never change). */
export function localizeConfig(config: QuestionnaireConfig, lang: "ru" | "kz"): QuestionnaireConfig {
  if (lang !== "kz") return config;
  return {
    ...config,
    doctor_note: { ...config.doctor_note, label: config.doctor_note.label_kz ?? config.doctor_note.label },
    questions: config.questions.map((q) => ({
      ...q,
      label: q.label_kz ?? q.label,
      options: q.options?.map((o) => ({ ...o, label: o.label_kz ?? o.label })),
    })),
  };
}
