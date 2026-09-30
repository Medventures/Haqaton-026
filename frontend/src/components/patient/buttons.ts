/** Patient-side button styles (Green Clinic v5). Press = scale(.98), no hover lift. */

const base =
  "inline-flex select-none items-center justify-center gap-3 rounded-full font-semibold transition-[transform,background-color,border-color,box-shadow,color] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#03392D] focus-visible:ring-offset-2 focus-visible:ring-offset-white/0";

export const btnPrimary = `${base} h-14 bg-[#03392D] pl-7 pr-2 text-[17px] text-white shadow-[0_1px_2px_rgba(3,57,45,.12),0_12px_28px_rgba(3,57,45,.22)] hover:bg-[#02281f]`;

/**
 * Primary button whose label is visually centred while the arrow sits at the
 * right edge (absolutely positioned). Use with `btnPrimaryArrow` inside a
 * `relative` container: symmetrical horizontal padding keeps the text centred.
 */
export const btnPrimaryCentered = `${base} relative h-14 bg-[#03392D] px-14 text-[17px] text-white shadow-[0_1px_2px_rgba(3,57,45,.12),0_12px_28px_rgba(3,57,45,.22)] hover:bg-[#02281f]`;

/** White circle with an arrow that sits at the right end of btnPrimary (flex layout). */
export const btnPrimaryIcon =
  "grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white transition-transform duration-200 group-hover:translate-x-0.5";

/** Arrow circle absolutely pinned to the right edge — pairs with btnPrimaryCentered. */
export const btnPrimaryArrow =
  "pointer-events-none absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition-transform duration-200 group-hover:translate-x-0.5";

export const btnSecondary = `${base} h-14 border border-[#03392D]/12 bg-white/80 px-7 text-[17px] text-[#03392D] backdrop-blur-xl hover:border-[#03392D]/30 hover:bg-white`;

export const btnGhost = `${base} h-11 px-4 text-[15px] text-[#03392D]/75 hover:text-[#03392D]`;

export const iconBtn = `${base} h-11 w-11 border border-[#03392D]/10 bg-white/75 text-[#03392D] backdrop-blur-xl hover:bg-white`;

export const glass =
  "border border-white/70 bg-white/70 shadow-[0_1px_2px_rgba(3,57,45,.06),0_12px_32px_rgba(3,57,45,.10)] backdrop-blur-xl";

export const fieldBase =
  "h-14 w-full rounded-2xl border border-[#03392D]/12 bg-white px-4 text-lg text-[#18342A] outline-none transition placeholder:text-[#9fb2a9] focus:border-[#03392D]/50 focus:ring-4 focus:ring-[#03392D]/10";
