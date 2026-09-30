import { type ReactNode } from "react";
import { serifHeading } from "@/components/app/AppShell";

/*
 * Dark-theme design tokens for the clinic workspace, in the spirit of the
 * Claude desktop dark mode — green accented.
 *
 *   page bg     #0F1412
 *   sidebar     #131A17
 *   card        #18201C, 1px border rgba(255,255,255,0.07)
 *   text        #E8EFEA (primary), #9AABA2 (muted)
 *   accents     #8BC53F (lime), #3FA37A (green)
 *   amber       #F2B84B (warnings)
 *   red         #F07167 (errors)
 */

export const DARK = {
  pageBg: "#0F1412",
  sidebarBg: "#131A17",
  cardBg: "#18201C",
  text: "#E8EFEA",
  muted: "#9AABA2",
  lime: "#8BC53F",
  green: "#3FA37A",
  amber: "#F2B84B",
  red: "#F07167",
} as const;

/** Hairline dark card. */
export const cardDark = "rounded-2xl border border-white/[0.07] bg-[#18201C]";

/** Dark text-input / date-field class. */
export const inputDark =
  "rounded-xl border border-white/10 bg-[#0F1412] text-[#E8EFEA] placeholder:text-[#9AABA2] outline-none transition focus:border-[#8BC53F] focus:ring-2 focus:ring-[#8BC53F]/40";

/** Neutral status pill (dark). */
export const pillDark = "inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[12px] font-medium text-[#E8EFEA]";

/** Lime-tinted status pill (dark). */
export const pillLime = "inline-flex items-center rounded-full bg-[#8BC53F]/15 px-2.5 py-1 text-[12px] font-medium text-[#B9E07F]";

/** Amber-tinted status pill (dark). */
export const pillAmber = "inline-flex items-center rounded-full bg-[#F2B84B]/15 px-2.5 py-1 text-[12px] font-medium text-[#F2C97A]";

/** Format today's date, RU. */
function todayLabel(): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  } catch {
    return "";
  }
}

/**
 * Consistent dark page header for every staff screen:
 * title (+ optional eyebrow) on the left, today's date and optional actions on the right.
 */
export function StaffPageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  showDate = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  showDate?: boolean;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] pb-5">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[#8BC53F]">{eyebrow}</p> : null}
        <h1 className={`${serifHeading} text-[28px] text-[#E8EFEA]`}>{title}</h1>
        {subtitle ? <p className="mt-1 text-[14.5px] text-[#9AABA2]">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {showDate ? (
          <span className="hidden text-[13px] capitalize tabular-nums text-[#9AABA2] sm:block">{todayLabel()}</span>
        ) : null}
        {actions}
      </div>
    </header>
  );
}
