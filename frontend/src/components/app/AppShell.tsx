import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Menu, PanelLeftClose, X } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";

/*
 * Claude-app-like shell shared by the patient cabinet and the staff CRM:
 *  - quiet tinted sidebar: logo, one primary action ("New ..."), nav, "recent" list, account row at the bottom
 *  - calm main pane with a centered reading column
 *  - mobile: top bar + slide-in drawer
 *
 * Two themes:
 *  - light (default) — Green Clinic patient palette, unchanged.
 *  - dark — refined Claude-desktop-dark, green accented, used by the clinic workspace.
 */

export type ShellTheme = "light" | "dark";

export type ShellNavItem = { to: string; label: string; icon: ReactNode; badge?: string | number; end?: boolean };
export type ShellRecentItem = { key: string; to: string; label: string; meta?: string; active?: boolean; dot?: "green" | "amber" | "grey" };

export const serifHeading = "font-['Iowan_Old_Style','Palatino_Linotype',Georgia,ui-serif,serif] tracking-[-0.01em]";

/** Theme context so descendant helpers (cards, headers) can pick the right palette. */
const ShellThemeContext = createContext<ShellTheme>("light");
export function useShellTheme(): ShellTheme {
  return useContext(ShellThemeContext);
}

export function AppShell({
  primaryAction,
  nav,
  recentTitle,
  recent = [],
  account,
  children,
  wide = false,
  theme = "light",
}: {
  primaryAction?: ReactNode;
  nav: ShellNavItem[];
  recentTitle?: string;
  recent?: ShellRecentItem[];
  account?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  theme?: ShellTheme;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const dark = theme === "dark";

  useEffect(() => setOpen(false), [location.pathname, location.search]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-4">
        <Link
          to="/"
          className={`rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 ${dark ? "focus-visible:ring-[#8BC53F]" : "focus-visible:ring-[#03392D]"}`}
          aria-label="Green Clinic"
        >
          <img src="/prime-logo.svg" alt="PRIME Green Clinic" className="h-7 w-auto" />
        </Link>
        <button
          type="button"
          className={`hidden h-9 w-9 place-items-center rounded-lg transition lg:grid ${
            dark ? "text-[#9AABA2] hover:bg-white/[0.06] hover:text-[#E8EFEA]" : "text-[#52655B] hover:bg-[#03392D]/[0.06] hover:text-[#03392D]"
          }`}
          aria-label="Свернуть панель"
          onClick={() => setCollapsed(true)}
        >
          <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <button
          type="button"
          className={`grid h-9 w-9 place-items-center rounded-lg lg:hidden ${
            dark ? "text-[#9AABA2] hover:bg-white/[0.06]" : "text-[#52655B] hover:bg-[#03392D]/[0.06]"
          }`}
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {primaryAction ? <div className="px-3 pb-3">{primaryAction}</div> : null}

      <nav className="grid gap-0.5 px-3" aria-label="Разделы">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex h-10 items-center gap-3 rounded-xl px-3 text-[14.5px] transition ${
                dark
                  ? isActive
                    ? "bg-white/[0.06] font-semibold text-[#E8EFEA]"
                    : "text-[#9AABA2] hover:bg-white/[0.04] hover:text-[#E8EFEA]"
                  : isActive
                    ? "bg-[#03392D]/[0.08] font-semibold text-[#10261E]"
                    : "text-[#3d5048] hover:bg-[#03392D]/[0.05]"
              }`
            }
          >
            <span className={dark ? "text-[#8BC53F]" : "text-[#03392D]/70"}>{item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge !== undefined ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums ${
                  dark ? "bg-[#8BC53F]/15 text-[#B9E07F]" : "bg-[#03392D]/[0.08] text-[#03392D]"
                }`}
              >
                {item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {recent.length ? (
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {recentTitle ? (
            <p className={`px-3 pb-2 text-[12px] font-semibold ${dark ? "text-[#9AABA2]" : "text-[#52655B]"}`}>{recentTitle}</p>
          ) : null}
          <ul className="grid gap-0.5">
            {recent.map((item) => (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition ${
                    dark
                      ? item.active
                        ? "bg-white/[0.06] text-[#E8EFEA]"
                        : "text-[#9AABA2] hover:bg-white/[0.04] hover:text-[#E8EFEA]"
                      : item.active
                        ? "bg-[#03392D]/[0.08] text-[#10261E]"
                        : "text-[#3d5048] hover:bg-[#03392D]/[0.05]"
                  }`}
                >
                  {item.dot ? (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        item.dot === "green"
                          ? dark
                            ? "bg-[#8BC53F]"
                            : "bg-[#5a9a1f]"
                          : item.dot === "amber"
                            ? dark
                              ? "bg-[#F2B84B]"
                              : "bg-[#d98e04]"
                            : dark
                              ? "bg-white/25"
                              : "bg-[#03392D]/25"
                      }`}
                      aria-hidden
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.meta ? (
                    <span className={`shrink-0 text-[12px] tabular-nums ${dark ? "text-[#9AABA2]" : "text-[#52655B]"}`}>{item.meta}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {account ? <div className={`border-t p-3 ${dark ? "border-white/[0.07]" : "border-[#03392D]/[0.08]"}`}>{account}</div> : null}
    </div>
  );

  return (
    <ShellThemeContext.Provider value={theme}>
      <div className={`min-h-[100dvh] ${dark ? "bg-[#0F1412] text-[#E8EFEA]" : "bg-[#FBFCFA] text-[#18342A]"}`} translate="no">
        {/* Desktop sidebar */}
        {!collapsed ? (
          <aside
            className={`fixed inset-y-0 left-0 z-30 hidden w-[272px] border-r lg:block ${
              dark ? "border-white/[0.07] bg-[#131A17]" : "border-[#03392D]/[0.08] bg-[#F3F6F2]"
            }`}
          >
            {sidebar}
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Открыть панель"
            className={`fixed left-3 top-3 z-30 hidden h-10 w-10 place-items-center rounded-xl border lg:grid ${
              dark
                ? "border-white/10 bg-[#18201C] text-[#8BC53F]"
                : "border-[#03392D]/10 bg-white text-[#03392D] shadow-sm"
            }`}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        )}

        {/* Mobile top bar + drawer */}
        <div
          className={`sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-3 backdrop-blur lg:hidden ${
            dark ? "border-white/[0.07] bg-[#0F1412]/90" : "border-[#03392D]/[0.08] bg-[#FBFCFA]/90"
          }`}
        >
          <button
            type="button"
            className={`grid h-10 w-10 place-items-center rounded-xl ${
              dark ? "text-[#8BC53F] hover:bg-white/[0.06]" : "text-[#03392D] hover:bg-[#03392D]/[0.06]"
            }`}
            aria-label="Меню"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <img src="/prime-logo.svg" alt="PRIME Green Clinic" className="h-6 w-auto" />
        </div>
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Закрыть"
              className={`gc-backdrop absolute inset-0 ${dark ? "bg-black/50" : "bg-[#18342A]/30"}`}
              onClick={() => setOpen(false)}
            />
            <aside className={`gc-sheet absolute inset-y-0 left-0 w-[86%] max-w-[300px] shadow-2xl ${dark ? "bg-[#131A17]" : "bg-[#F3F6F2]"}`}>
              {sidebar}
            </aside>
          </div>
        ) : null}

        <main className={`${collapsed ? "" : "lg:pl-[272px]"}`}>
          <div className={`mx-auto w-full px-4 pb-20 pt-6 md:px-8 md:pt-10 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</div>
        </main>
      </div>
    </ShellThemeContext.Provider>
  );
}

/** Primary sidebar action, like Claude's "New chat". */
export function ShellPrimaryButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  const dark = useShellTheme() === "dark";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[14.5px] font-semibold transition active:scale-[0.99] ${
        dark
          ? "bg-[#8BC53F] text-[#0F1412] hover:bg-[#9BD455]"
          : "bg-[#03392D] text-white shadow-[0_1px_2px_rgba(3,57,45,.2)] hover:bg-[#02281f]"
      }`}
    >
      <span className={`grid h-6 w-6 place-items-center rounded-full ${dark ? "bg-black/10" : "bg-white/15"}`}>{icon}</span>
      {children}
    </button>
  );
}

/** Bottom account row (avatar + name + subtitle), opens a caller-provided menu. */
export function ShellAccount({ initials, name, subtitle, children }: { initials: string; name: string; subtitle?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const dark = useShellTheme() === "dark";
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${
          dark ? "hover:bg-white/[0.06]" : "hover:bg-[#03392D]/[0.05]"
        }`}
      >
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
            dark ? "bg-gradient-to-br from-[#3FA37A] to-[#8BC53F] text-[#0F1412]" : "bg-gradient-to-br from-[#0b5a47] to-[#03392D] text-white"
          }`}
        >
          {initials || "•"}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] font-semibold ${dark ? "text-[#E8EFEA]" : "text-[#10261E]"}`}>{name}</span>
          {subtitle ? <span className={`block truncate text-[12px] ${dark ? "text-[#9AABA2]" : "text-[#52655B]"}`}>{subtitle}</span> : null}
        </span>
      </button>
      {open && children ? (
        <div
          className={`gc-pop absolute bottom-[calc(100%+6px)] left-0 right-0 rounded-2xl border p-1.5 ${
            dark
              ? "border-white/10 bg-[#18201C] shadow-[0_12px_32px_rgba(0,0,0,.45)]"
              : "border-[#03392D]/10 bg-white shadow-[0_12px_32px_rgba(3,57,45,.14)]"
          }`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ShellMenuItem({ icon, children, onClick }: { icon?: ReactNode; children: ReactNode; onClick: () => void }) {
  const dark = useShellTheme() === "dark";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] transition ${
        dark ? "text-[#E8EFEA] hover:bg-white/[0.06]" : "text-[#18342A] hover:bg-[#03392D]/[0.05]"
      }`}
    >
      {icon ? <span className={dark ? "text-[#8BC53F]" : "text-[#03392D]/70"}>{icon}</span> : null}
      {children}
    </button>
  );
}

/** Hairline card used inside the shell (no heavy shadows). Light theme only. */
export const shellCard = "rounded-2xl border border-[#03392D]/[0.09] bg-white";

/** Dark equivalent of shellCard for the clinic workspace. */
export const shellCardDark = "rounded-2xl border border-white/[0.07] bg-[#18201C]";
