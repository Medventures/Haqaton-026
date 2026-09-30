import type { QuestionnaireConfig } from "@/api/types";
import type { UiLang } from "@/features/patient-home/welcome";

/** Human "Что мы учли" chips from the submission answers. Max `limit`, question labels first. */
export function consideredChips(
  config: QuestionnaireConfig | null,
  answers: Record<string, unknown> | undefined,
  explanationTitles: string[],
  lang: UiLang,
  limit = 6,
): string[] {
  const chips: string[] = [];
  const yearsWord = lang === "kz" ? "жас" : "лет";

  const age = answers?.age_years;
  if (typeof age === "number") chips.push(`${age} ${yearsWord}`);

  if (config && answers) {
    const byId = new Map(config.questions.map((q) => [q.id, q]));
    const pushOption = (id: string) => {
      const q = byId.get(id);
      const value = answers[id];
      if (!q || typeof value !== "string") return;
      const option = q.options?.find((o) => o.code === value);
      const label = lang === "kz" ? option?.label_kz ?? option?.label : option?.label;
      if (label) chips.push(label);
    };
    pushOption("exam_applicability");
    pushOption("visit_reason");
  }

  for (const title of explanationTitles) {
    if (title) chips.push(title);
  }

  // De-dup, keep order, cap length.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chip of chips) {
    if (seen.has(chip)) continue;
    seen.add(chip);
    out.push(chip);
    if (out.length >= limit) break;
  }
  return out;
}
