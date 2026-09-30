/** Patient-side button styles (Green Clinic v5). Press = scale(.98), no hover lift. */

const base =
  "inline-flex select-none items-center justify-center gap-2.5 rounded-full font-semibold leading-none transition-[transform,background-color,border-color,box-shadow,color] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#03392D] focus-visible:ring-offset-2 focus-visible:ring-offset-white/0";

/**
 * Primary action. Centred label with at most one inline icon (gap-2.5).
 * Symmetric horizontal padding — no absolutely positioned arrows. h-14.
 */
export const btnPrimary = `${base} h-14 bg-[#03392D] px-6 text-[17px] text-white shadow-[0_1px_2px_rgba(3,57,45,.12),0_12px_28px_rgba(3,57,45,.22)] hover:bg-[#02281f]`;

/** Alias kept for callers; identical to the centred primary style. */
export const btnPrimaryCentered = btnPrimary;

/**
 * Deprecated icon-circle helpers. Kept as no-op inline spans so any lingering
 * caller still renders a centred inline icon rather than an offset circle.
 */
export const btnPrimaryIcon = "inline-flex h-5 w-5 shrink-0 items-center justify-center";

export const btnPrimaryArrow = "inline-flex h-5 w-5 shrink-0 items-center justify-center";

/** Secondary action. Same centred inline layout, h-14. */
export const btnSecondary = `${base} h-14 border border-[#03392D]/12 bg-white/80 px-6 text-[17px] text-[#03392D] backdrop-blur-xl hover:border-[#03392D]/30 hover:bg-white`;

export const btnGhost = `${base} h-11 px-4 text-[15px] text-[#03392D]/75 hover:text-[#03392D]`;

export const iconBtn = `${base} h-11 w-11 border border-[#03392D]/10 bg-white/75 text-[#03392D] backdrop-blur-xl hover:bg-white`;

export const glass =
  "border border-white/70 bg-white/70 shadow-[0_1px_2px_rgba(3,57,45,.06),0_12px_32px_rgba(3,57,45,.10)] backdrop-blur-xl";

export const fieldBase =
  "h-14 w-full rounded-2xl border border-[#03392D]/12 bg-white px-4 text-lg text-[#18342A] outline-none transition placeholder:text-[#9fb2a9] focus:border-[#03392D]/50 focus:ring-4 focus:ring-[#03392D]/10";
