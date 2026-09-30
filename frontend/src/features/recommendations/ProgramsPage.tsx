import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, Info, Minus, Plus, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { api } from "@/api/client";
import type { ComparisonRow, Offer, OfferTier, QuestionnaireConfig, TierGroup } from "@/api/types";
import { track } from "@/analytics/tracker";
import { btnPrimary, btnPrimaryIcon, btnSecondary, glass } from "@/components/patient/buttons";
import { PatientShell } from "@/components/patient/PatientTopBar";
import { getFlow, type BookingLocationState, type ProgramsLocationState } from "@/features/intake/flowState";
import { useUiLang, type UiLang } from "@/features/patient-home/welcome";
import { consideredChips } from "@/features/recommendations/planLabels";
import "@/features/recommendations/programs.css";

const COPY = {
  ru: {
    title: "Ваш отчёт готов",
    considered: "Что мы учли",
    optimal: "Оптимальный",
    maximum: "Максимальный",
    recommendedOptimal: "Рекомендуем по вашим ответам",
    fullest: "Самый полный",
    recommend: "Рекомендуем",
    withDoctor: "Выберем с терапевтом",
    blocksCount: (n: number) => `${n} ${plural(n, "блок", "блока", "блоков")} исследований`,
    priceUnknown: "Стоимость уточняется в клинике",
    onlyHere: "только здесь",
    adaptTitle: "Дополним под вас",
    adaptNote: "Эти пункты обсуждаются на приёме.",
    book: "Записаться к терапевту",
    discuss: "Обсудить с терапевтом",
    why: "Почему так",
    included: "Что входит",
    detailsMore: "Подробнее о составе",
    detailsLess: "Свернуть состав",
    female: "Женский",
    male: "Мужской",
    disclaimer: "Предварительный подбор. Точный план подтверждает врач.",
    noOffer: "Точную программу подберём вместе с терапевтом на приёме.",
    bookTherapist: "Записаться к терапевту",
    unavailableTitle: "Программы недоступны",
    unavailableSub: "Сначала пройдите анкету — результат не читается из адресной строки.",
    toIntake: "К анкете",
  },
  kz: {
    title: "Есебіңіз дайын",
    considered: "Нені ескердік",
    optimal: "Оңтайлы",
    maximum: "Максималды",
    recommendedOptimal: "Жауаптарыңыз бойынша ұсынамыз",
    fullest: "Ең толық",
    recommend: "Ұсынамыз",
    withDoctor: "Терапевтпен таңдаймыз",
    blocksCount: (n: number) => `${n} зерттеу блогы`,
    priceUnknown: "Құны клиникада нақтыланады",
    onlyHere: "тек осында",
    adaptTitle: "Сізге қарай толықтырамыз",
    adaptNote: "Бұл тармақтар қабылдауда талқыланады.",
    book: "Терапевтке жазылу",
    discuss: "Терапевтпен талқылау",
    why: "Неге олай",
    included: "Не кіреді",
    detailsMore: "Құрамы туралы толығырақ",
    detailsLess: "Құрамын жасыру",
    female: "Әйел",
    male: "Ер",
    disclaimer: "Алдын ала іріктеу. Нақты жоспарды дәрігер бекітеді.",
    noOffer: "Нақты бағдарламаны терапевтпен қабылдауда таңдаймыз.",
    bookTherapist: "Терапевтке жазылу",
    unavailableTitle: "Бағдарламалар қолжетімсіз",
    unavailableSub: "Алдымен сауалнамадан өтіңіз — нәтиже мекенжайдан оқылмайды.",
    toIntake: "Сауалнамаға",
  },
} as const;

type Copy = (typeof COPY)[UiLang];

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function labelOf(row: ComparisonRow, lang: UiLang): string {
  return lang === "kz" ? row.label_kz : row.label_ru;
}

/** Price text: whole tenge with ru-RU grouping ('от 356 000 ₸') or a clinic fallback. */
export function formatPrice(priceMinor: number | null | undefined, currency: string | null | undefined, lang: UiLang): string {
  if (typeof priceMinor !== "number" || !Number.isFinite(priceMinor)) return COPY[lang].priceUnknown;
  const amount = priceMinor.toLocaleString(lang === "kz" ? "kk-KZ" : "ru-RU", { maximumFractionDigits: 0 });
  const sign = currency === "KZT" || !currency ? "₸" : currency;
  const from = lang === "kz" ? "" : "от ";
  return lang === "kz" ? `${amount} ${sign}-тен` : `${from}${amount} ${sign}`;
}

/** Bare grouped amount with currency sign, no "от"/"-тен" prefix ('356 000 ₸'). */
function priceAmount(priceMinor: number, currency: string | null | undefined, lang: UiLang): string {
  const amount = priceMinor.toLocaleString(lang === "kz" ? "kk-KZ" : "ru-RU", { maximumFractionDigits: 0 });
  const sign = currency === "KZT" || !currency ? "₸" : currency;
  return `${amount} ${sign}`;
}

/** Rounded discount percentage when there is a strictly higher old price. */
function discountPercent(oldMinor: number, newMinor: number): number {
  if (!(oldMinor > newMinor) || oldMinor <= 0) return 0;
  return Math.round(((oldMinor - newMinor) / oldMinor) * 100);
}

export function ProgramsPage() {
  const location = useLocation();
  const lang = useUiLang();
  const copy = COPY[lang];
  const preview = (location.state as ProgramsLocationState | null)?.preview ?? null;
  const offer = preview?.offer ?? null;

  const [config, setConfig] = useState<QuestionnaireConfig | null>(null);
  const [sexTab, setSexTab] = useState<"female" | "male">("female");
  const [activeExplanation, setActiveExplanation] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .questionnaire()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch(() => {
        /* chips degrade gracefully without labels */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    track("page_viewed", { screen_id: "programs" });
    if (preview) track("recommendations_viewed", { screen_id: "programs" });
  }, [preview]);

  const group: TierGroup | null = useMemo(() => {
    if (!offer || offer.groups.length === 0) return null;
    if (offer.groups.length === 1) return offer.groups[0]!;
    return offer.groups.find((g) => g.sex === sexTab) ?? offer.groups[0]!;
  }, [offer, sexTab]);

  const submission = getFlow()?.submission;
  const explanationTitles = useMemo(
    () => (offer?.explanations ?? []).map((e) => (lang === "kz" ? e.title_kz || e.title_ru : e.title_ru)),
    [offer, lang],
  );
  const chips = useMemo(
    () => consideredChips(config, submission?.answers, explanationTitles, lang),
    [config, submission, explanationTitles, lang],
  );

  // Blocks highlighted by the hovered/focused explanation → soft green rows in the table.
  const highlightBlocks = useMemo(() => {
    if (!offer) return new Set<string>();
    const ex = offer.explanations.find((e) => e.id === activeExplanation);
    return new Set(ex?.blocks ?? []);
  }, [offer, activeExplanation]);

  if (!preview) {
    return (
      <PatientShell>
        <main className="mx-auto grid min-h-[100dvh] max-w-md place-content-center justify-items-center gap-5 px-6 pt-28 text-center">
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#10261E]">{copy.unavailableTitle}</h1>
          <p className="text-[#52655B]">{copy.unavailableSub}</p>
          <Link to="/intake" className={btnSecondary}>
            {copy.toIntake}
          </Link>
        </main>
      </PatientShell>
    );
  }

  // No offer → simple message + CTA to therapist with the first candidate if any.
  if (!offer || !group) {
    const firstCandidate = preview.candidates.find((c) => c.eligibility !== "ineligible") ?? null;
    const bookingState: BookingLocationState = {
      packageId: firstCandidate?.package_id ?? "",
      consultationReason: "discuss_preliminary_programme",
      revisionId: preview.revision_id,
      revision_id: preview.revision_id,
      selected_package_id: firstCandidate?.package_id ?? undefined,
      consultation_reason: "discuss_preliminary_programme",
      submission,
    };
    return (
      <PatientShell>
        <main className="mx-auto grid min-h-[100dvh] max-w-md place-content-center justify-items-center gap-6 px-6 pt-28 text-center">
          <h1 className="text-[30px] font-bold tracking-[-0.03em] text-[#10261E] md:text-[38px]">{copy.title}</h1>
          <p className="text-[#52655B]">{copy.noOffer}</p>
          <Link
            to="/booking"
            state={bookingState}
            className={`group ${btnPrimary} justify-between sm:min-w-64`}
            onClick={() => track("cta_clicked", { component_id: "programs_no_offer" })}
          >
            <span>{copy.bookTherapist}</span>
            <span className={btnPrimaryIcon}>
              <ArrowRight className="h-5 w-5" aria-hidden />
            </span>
          </Link>
          <p className="text-[13px] text-[#52655B]">{copy.disclaimer}</p>
        </main>
      </PatientShell>
    );
  }

  const recommendation = lang === "kz" ? offer.recommendation_kz : offer.recommendation_ru;
  const twoGroups = offer.groups.length > 1;

  function ctaFor(slot: "optimal" | "maximum", tier: OfferTier) {
    const discuss = offer!.cta === "discuss";
    const label = discuss ? copy.discuss : copy.book;
    const reason = discuss ? "discuss_preliminary_programme" : "check_programme";
    const bookingState: BookingLocationState = {
      packageId: tier.package_id,
      consultationReason: reason,
      revisionId: preview!.revision_id,
      revision_id: preview!.revision_id,
      selected_package_id: tier.package_id,
      consultation_reason: reason,
      program_name: tier.name,
      price_minor: tier.price_minor,
      price_old_minor: tier.price_old_minor,
      currency: tier.currency,
      submission,
    };
    return { label, bookingState, slot };
  }

  return (
    <PatientShell>
      <main className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col gap-10 px-5 pb-20 pt-28 md:px-8">
        {/* Header */}
        <header className="gc-rise grid gap-3 text-center">
          <h1 className="text-[34px] font-bold leading-[1.06] tracking-[-0.035em] text-[#10261E] md:text-[46px]">
            {copy.title}
          </h1>
          <p className="mx-auto max-w-2xl text-[17px] leading-relaxed text-[#52655B]">{recommendation}</p>
        </header>

        {/* Что мы учли */}
        {chips.length ? (
          <section className="gc-rise gc-d1 grid gap-3">
            <h2 className="text-center text-[13px] font-semibold uppercase tracking-[0.08em] text-[#03392D]/60">
              {copy.considered}
            </h2>
            <ul className="flex flex-wrap justify-center gap-2">
              {chips.map((chip) => (
                <li
                  key={chip}
                  className="rounded-full border border-[#03392D]/12 bg-white/70 px-4 py-1.5 text-[14px] font-medium text-[#18342A] backdrop-blur-xl"
                >
                  {chip}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Sex toggle for "discuss" */}
        {twoGroups ? (
          <div className="gc-rise gc-d1 mx-auto inline-flex rounded-full border border-[#03392D]/12 bg-white/70 p-1 backdrop-blur-xl">
            {(["female", "male"] as const).map((sex) => (
              <button
                key={sex}
                type="button"
                onClick={() => setSexTab(sex)}
                className={`rounded-full px-6 py-2 text-[15px] font-semibold transition active:scale-[0.98] ${
                  sexTab === sex ? "bg-[#03392D] text-white" : "text-[#03392D]/70"
                }`}
              >
                {sex === "female" ? copy.female : copy.male}
              </button>
            ))}
          </div>
        ) : null}

        {/* Cards */}
        <section className="grid gap-4 md:grid-cols-2">
          <TierCard
            tier={group.optimal}
            slot="optimal"
            variant="light"
            comparison={group.comparison}
            offer={offer}
            lang={lang}
            copy={copy}
            cta={ctaFor("optimal", group.optimal)}
            className="gc-rise gc-d2"
          />
          <TierCard
            tier={group.maximum}
            slot="maximum"
            variant="dark"
            comparison={group.comparison}
            offer={offer}
            lang={lang}
            copy={copy}
            cta={ctaFor("maximum", group.maximum)}
            className="gc-rise gc-d3"
          />
        </section>

        {/* Почему так */}
        {offer.explanations.length ? (
          <section className="gc-rise gc-d3 grid gap-4">
            <h2 className="text-[22px] font-bold tracking-[-0.02em] text-[#10261E]">{copy.why}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {offer.explanations.map((ex) => {
                const rows = group.comparison.filter((r) => ex.blocks.includes(r.block_id));
                return (
                  <article
                    key={ex.id}
                    tabIndex={0}
                    onMouseEnter={() => setActiveExplanation(ex.id)}
                    onMouseLeave={() => setActiveExplanation((prev) => (prev === ex.id ? null : prev))}
                    onFocus={() => setActiveExplanation(ex.id)}
                    onBlur={() => setActiveExplanation((prev) => (prev === ex.id ? null : prev))}
                    className={`${glass} grid gap-2 rounded-3xl p-5 outline-none transition ${
                      activeExplanation === ex.id ? "ring-2 ring-[#03392D]/40" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#03392D]/[0.06] text-[#03392D]">
                        <Info className="h-[18px] w-[18px]" aria-hidden />
                      </span>
                      <h3 className="text-[16px] font-semibold text-[#10261E]">
                        {lang === "kz" ? ex.title_kz || ex.title_ru : ex.title_ru}
                      </h3>
                    </div>
                    <p className="text-[14px] leading-relaxed text-[#52655B]">
                      {lang === "kz" ? ex.text_kz || ex.text_ru : ex.text_ru}
                    </p>
                    {rows.length ? (
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {rows.map((r) => (
                          <li
                            key={r.block_id}
                            className="rounded-full bg-[#8BC53F]/15 px-2.5 py-1 text-[12px] font-medium text-[#3f5a1a]"
                          >
                            {labelOf(r, lang)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Что входит — comparison table */}
        <section className="gc-rise gc-d3 grid gap-4">
          <h2 className="text-[22px] font-bold tracking-[-0.02em] text-[#10261E]">{copy.included}</h2>
          <div className={`${glass} overflow-hidden rounded-3xl`}>
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr className="border-b border-[#03392D]/10 text-[13px] font-semibold uppercase tracking-[0.04em] text-[#03392D]/60">
                  <th className="px-4 py-3 md:px-5">&nbsp;</th>
                  <th className="px-3 py-3 text-center">{copy.optimal}</th>
                  <th className="px-3 py-3 text-center">{copy.maximum}</th>
                </tr>
              </thead>
              <tbody>
                {group.comparison.map((row) => {
                  const hot = highlightBlocks.has(row.block_id);
                  return (
                    <tr
                      key={row.block_id}
                      className={`border-b border-[#03392D]/[0.06] last:border-0 transition-colors ${
                        hot ? "bg-[#8BC53F]/12" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-[#18342A] md:px-5">{labelOf(row, lang)}</td>
                      <td className="px-3 py-3 text-center">
                        {row.optimal ? (
                          <Check className="mx-auto h-5 w-5 text-[#03392D]" aria-label="✓" />
                        ) : (
                          <Minus className="mx-auto h-4 w-4 text-[#b7c7c0]" aria-label="—" />
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {row.maximum ? (
                          <Check className="mx-auto h-5 w-5 text-[#03392D]" aria-label="✓" />
                        ) : (
                          <Minus className="mx-auto h-4 w-4 text-[#b7c7c0]" aria-label="—" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-center text-[13px] text-[#52655B]">{copy.disclaimer}</p>
      </main>
    </PatientShell>
  );
}

/**
 * Price presentation shared by the plan cards and the booking summary.
 * - old > new  → struck-through old (small) + new (big) + '−N%' badge
 * - price only → single value
 * - no price   → "Стоимость уточняется в клинике"
 */
export function PriceBlock({
  priceMinor,
  priceOldMinor,
  currency,
  lang,
  dark = false,
  size = "lg",
}: {
  priceMinor: number | null | undefined;
  priceOldMinor?: number | null;
  currency: string | null | undefined;
  lang: UiLang;
  dark?: boolean;
  size?: "lg" | "sm";
}) {
  if (typeof priceMinor !== "number" || !Number.isFinite(priceMinor)) {
    return (
      <span className={`${size === "lg" ? "text-[16px]" : "text-[14px]"} font-semibold ${dark ? "text-white/80" : "text-[#52655B]"}`}>
        {COPY[lang].priceUnknown}
      </span>
    );
  }
  const hasOld = typeof priceOldMinor === "number" && Number.isFinite(priceOldMinor) && priceOldMinor > priceMinor;
  const pct = hasOld ? discountPercent(priceOldMinor!, priceMinor) : 0;
  const bigClass = size === "lg" ? "text-[24px]" : "text-[15px]";
  const oldClass = size === "lg" ? "text-[14px]" : "text-[12px]";
  return (
    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 ${dark ? "text-white" : "text-[#10261E]"}`}>
      {hasOld ? (
        <span className={`${oldClass} font-medium line-through ${dark ? "text-white/50" : "text-[#9fb2a9]"}`}>
          {priceAmount(priceOldMinor!, currency, lang)}
        </span>
      ) : null}
      <span className={`${bigClass} font-bold tracking-[-0.02em]`}>{priceAmount(priceMinor, currency, lang)}</span>
      {hasOld && pct > 0 ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${
            dark ? "bg-[#8BC53F] text-[#0a2a12]" : "bg-[#8BC53F]/20 text-[#3f5a1a]"
          }`}
        >
          −{pct}%
        </span>
      ) : null}
    </div>
  );
}

function TierCard({
  tier,
  slot,
  variant,
  comparison,
  offer,
  lang,
  copy,
  cta,
  className,
}: {
  tier: OfferTier;
  slot: "optimal" | "maximum";
  variant: "light" | "dark";
  comparison: ComparisonRow[];
  offer: Offer;
  lang: UiLang;
  copy: Copy;
  cta: { label: string; bookingState: BookingLocationState; slot: "optimal" | "maximum" };
  className?: string;
}) {
  const dark = variant === "dark";
  const recommended = offer.recommended === slot;
  const noRecommendation = offer.recommended === null;
  const labelById = new Map(comparison.map((r) => [r.block_id, labelOf(r, lang)]));
  const note = lang === "kz" ? tier.note_kz : tier.note_ru;
  const adaptation = lang === "kz" ? tier.adaptation_kz : tier.adaptation_ru;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const badges: Array<{ text: string; tone: "green" | "soft" }> = [];
  if (slot === "optimal" && recommended) badges.push({ text: copy.recommendedOptimal, tone: "green" });
  if (slot === "maximum") {
    badges.push({ text: copy.fullest, tone: dark ? "soft" : "green" });
    if (recommended) badges.push({ text: copy.recommend, tone: "green" });
  }
  if (noRecommendation) badges.push({ text: copy.withDoctor, tone: "soft" });

  return (
    <article
      className={`${className ?? ""} relative flex flex-col gap-5 rounded-[28px] p-6 md:p-7 ${
        dark
          ? "bg-gradient-to-br from-[#0b5a47] via-[#03392D] to-[#022a21] text-white shadow-[0_24px_60px_rgba(3,57,45,.32)]"
          : `border bg-white/80 text-[#18342A] backdrop-blur-xl shadow-[0_12px_32px_rgba(3,57,45,.10)] ${
              recommended ? "border-[#03392D] ring-2 ring-[#03392D]" : "border-white/70"
            }`
      }`}
    >
      {badges.length ? (
        <div className="flex flex-wrap gap-2">
          {badges.map((b) => (
            <span
              key={b.text}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                b.tone === "green"
                  ? dark
                    ? "bg-[#8BC53F] text-[#0a2a12]"
                    : "bg-[#03392D] text-white"
                  : dark
                    ? "bg-white/15 text-white"
                    : "bg-[#03392D]/[0.06] text-[#03392D]"
              }`}
            >
              {b.text}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-1">
        <span className={`text-[13px] font-semibold uppercase tracking-[0.08em] ${dark ? "text-white/60" : "text-[#03392D]/60"}`}>
          {slot === "optimal" ? copy.optimal : copy.maximum}
        </span>
        <h3 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">{tier.name}</h3>
        <span className={`text-[14px] ${dark ? "text-white/70" : "text-[#52655B]"}`}>
          {copy.blocksCount(tier.block_ids.length)}
        </span>
      </div>

      <PriceBlock
        priceMinor={tier.price_minor}
        priceOldMinor={tier.price_old_minor}
        currency={tier.currency}
        lang={lang}
        dark={dark}
        size="lg"
      />

      {note ? <p className={`text-[14px] leading-relaxed ${dark ? "text-white/75" : "text-[#52655B]"}`}>{note}</p> : null}

      <ul className="grid gap-2">
        {tier.block_ids.slice(0, 5).map((blockId) => {
          const isExtra = slot === "maximum" && tier.extra_block_ids.includes(blockId);
          return (
            <li key={blockId} className="flex items-center gap-2.5 text-[15px]">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  dark ? "bg-[#8BC53F] text-[#0a2a12]" : "bg-[#03392D]/[0.08] text-[#03392D]"
                }`}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
              </span>
              <span className={dark ? "text-white/90" : "text-[#18342A]"}>{labelById.get(blockId) ?? blockId}</span>
              {isExtra ? (
                <span
                  className={`ml-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    dark ? "bg-white/15 text-white" : "bg-[#8BC53F]/20 text-[#3f5a1a]"
                  }`}
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  {copy.onlyHere}
                </span>
              ) : null}
            </li>
          );
        })}
        {tier.block_ids.length > 5 ? (
          <li className={`pl-[30px] text-[13px] ${dark ? "text-white/60" : "text-[#52655B]"}`}>
            +{tier.block_ids.length - 5} {plural(tier.block_ids.length - 5, "блок", "блока", "блоков")}
          </li>
        ) : null}
      </ul>

      {tier.variant === "adapted" && adaptation.length ? (
        <div className={`grid gap-2 rounded-2xl p-4 ${dark ? "bg-white/10" : "bg-[#8BC53F]/10"}`}>
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            <Sparkles className="h-4 w-4" aria-hidden />
            {copy.adaptTitle}
          </span>
          <ul className="grid gap-1">
            {adaptation.map((topic) => (
              <li key={topic} className={`flex items-start gap-2 text-[14px] ${dark ? "text-white/85" : "text-[#18342A]"}`}>
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                {topic}
              </li>
            ))}
          </ul>
          <p className={`text-[12px] ${dark ? "text-white/60" : "text-[#52655B]"}`}>{copy.adaptNote}</p>
        </div>
      ) : null}

      <div className="mt-auto grid gap-3 pt-2">
        <Link
          to="/booking"
          state={cta.bookingState}
          onClick={() => track("cta_clicked", { component_id: `programs_${slot}` })}
          className={`group inline-flex h-14 items-center justify-between gap-3 rounded-full pl-7 pr-2 text-[16px] font-semibold transition-[transform,background-color] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            dark
              ? "bg-white text-[#03392D] hover:bg-white/90 focus-visible:ring-white"
              : "bg-[#03392D] text-white hover:bg-[#02281f] focus-visible:ring-[#03392D]"
          }`}
        >
          <span>{cta.label}</span>
          <span
            className={`grid h-10 w-10 place-items-center rounded-full transition-transform duration-200 group-hover:translate-x-0.5 ${
              dark ? "bg-[#03392D]/10 text-[#03392D]" : "bg-white/15 text-white"
            }`}
          >
            <ArrowRight className="h-5 w-5" aria-hidden />
          </span>
        </Link>
      </div>

      {tier.details.length ? (
        <div className={`border-t pt-1 ${dark ? "border-white/15" : "border-[#03392D]/[0.08]"}`}>
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((v) => !v)}
            className={`flex w-full items-center justify-between gap-2 py-2 text-[14px] font-semibold transition-colors ${
              dark ? "text-white/85 hover:text-white" : "text-[#03392D] hover:text-[#02281f]"
            }`}
          >
            <span>{detailsOpen ? copy.detailsLess : copy.detailsMore}</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform duration-300 ${detailsOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          <div
            className={`grid transition-all duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${
              detailsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <ul className="grid gap-2 pb-1 pt-2">
                {tier.details.map((item) => (
                  <li key={item.id} className="flex items-start gap-2.5 text-[14px] leading-snug">
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                        dark ? "bg-[#8BC53F] text-[#0a2a12]" : "bg-[#03392D]/[0.08] text-[#03392D]"
                      }`}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                    </span>
                    <span className={dark ? "text-white/85" : "text-[#3a4d44]"}>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
