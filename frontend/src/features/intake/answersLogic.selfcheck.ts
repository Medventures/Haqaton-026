/**
 * Feature-local checks without a test runner.
 * Run: frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit
 * Then evaluate via Node after build, or import from a future runner.
 */
import {
  applyExclusiveMulti,
  conditionMet,
  isRequired,
  isVisible,
  projectActiveAnswers,
  type Answers,
} from "@/features/intake/answersLogic";
import type { QuestionDef, QuestionnaireConfig } from "@/api/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const pregnancy: QuestionDef = {
  id: "pregnancy",
  block: "wellbeing",
  answer_type: "single",
  label: "pregnancy",
  show_if: { id: "exam_applicability", in: ["female", "discuss"] },
  required_if: { id: "exam_applicability", in: ["female", "discuss"] },
  options: [
    { code: "yes", label: "Да" },
    { code: "no", label: "Нет" },
    { code: "unknown", label: "Не уверена" },
  ],
};

const symptoms: QuestionDef = {
  id: "symptoms",
  block: "wellbeing",
  answer_type: "multi",
  label: "symptoms",
  exclusive: ["none", "unsure"],
  options: [
    { code: "none", label: "Нет" },
    { code: "unsure", label: "Не уверен" },
    { code: "other", label: "Другое" },
  ],
};

const config: QuestionnaireConfig = {
  questionnaire_version: "demo-intake-v1",
  mode: "demo",
  blocks: ["about", "wellbeing", "history", "results", "review"],
  doctor_note: { max_length: 200, label: "note" },
  questions: [
    {
      id: "exam_applicability",
      block: "about",
      answer_type: "single",
      label: "exam",
      required: true,
      options: [
        { code: "female", label: "Женский" },
        { code: "male", label: "Мужской" },
      ],
    },
    pregnancy,
    symptoms,
  ],
};

export function runAnswersLogicSelfcheck(): void {
  const female: Answers = { exam_applicability: "female" };
  assert(isVisible(pregnancy, female), "pregnancy visible for female");
  assert(isRequired(pregnancy, female), "pregnancy required for female");

  const male: Answers = { exam_applicability: "male", pregnancy: "yes" };
  assert(!isVisible(pregnancy, male), "pregnancy hidden for male");
  const active = projectActiveAnswers(config, male);
  assert(active.pregnancy === undefined, "hidden pregnancy excluded from active projection");
  assert(active.exam_applicability === "male", "controlling answer kept");

  assert(conditionMet({ id: "exam_applicability", eq: "female" }, female), "eq works");
  assert(!conditionMet({ id: "exam_applicability", eq: "female" }, male), "eq rejects");

  const exclusiveOnly = applyExclusiveMulti(symptoms, ["other"], "none");
  assert(exclusiveOnly.length === 1 && exclusiveOnly[0] === "none", "exclusive clears others");

  const afterPositive = applyExclusiveMulti(symptoms, ["none"], "other");
  assert(afterPositive.includes("other") && !afterPositive.includes("none"), "positive clears exclusive");

  const unknownCode: string = "unknown";
  assert(unknownCode !== "no", "unknown is not no");
}
