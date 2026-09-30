import { useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutDashboard, LogIn, LogOut, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { initials, logoutPatient, usePatient } from "@/app/patientSession";
import { openLogin } from "@/components/patient/loginSheetStore";
import { welcomeCopy, useUiLang } from "@/features/patient-home/welcome";

/** Avatar circle: guest icon → opens login; signed in → initials + small menu. */
export function ProfileButton() {
  const lang = useUiLang();
  const copy = welcomeCopy[lang];
  const { me } = usePatient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = me ? me.display_name : copy.guest;
  const letters = initials(me?.display_name);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={`relative grid h-11 w-11 place-items-center rounded-full text-sm font-semibold transition active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#03392D] focus-visible:ring-offset-2 ${
          me
            ? "bg-gradient-to-br from-[#0b5a47] to-[#03392D] text-white shadow-[0_6px_16px_rgba(3,57,45,.28)]"
            : "border border-[#03392D]/10 bg-white/75 text-[#03392D] backdrop-blur-xl hover:bg-white"
        }`}
      >
        {me && letters ? letters : <UserRound className="h-5 w-5" strokeWidth={1.8} aria-hidden />}
        {me ? (
          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#8BC53F]" aria-hidden />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="gc-pop absolute right-0 top-[calc(100%+10px)] w-64 overflow-hidden rounded-3xl border border-white/70 bg-white/90 p-2 shadow-[0_1px_2px_rgba(3,57,45,.06),0_18px_40px_rgba(3,57,45,.16)] backdrop-blur-xl"
        >
          <div className="px-3 pb-3 pt-2">
            <p className="text-[15px] font-semibold text-[#18342A]">{label}</p>
            <p className="text-sm text-[#52655B]">{me?.phone ?? "Green Clinic"}</p>
          </div>
          <div className="h-px bg-[#03392D]/8" />
          {me ? (
            <>
              <MenuItem
                icon={<LayoutDashboard className="h-[18px] w-[18px]" aria-hidden />}
                onClick={() => {
                  setOpen(false);
                  navigate("/cabinet");
                }}
              >
                {copy.toCabinet}
              </MenuItem>
              <MenuItem
                icon={<LogOut className="h-[18px] w-[18px]" aria-hidden />}
                onClick={() => {
                  setOpen(false);
                  void logoutPatient().then(() => navigate("/"));
                }}
              >
                {copy.logout}
              </MenuItem>
            </>
          ) : (
            <MenuItem
              icon={<LogIn className="h-[18px] w-[18px]" aria-hidden />}
              onClick={() => {
                setOpen(false);
                openLogin("/cabinet");
              }}
            >
              {copy.toLogin}
            </MenuItem>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[15px] font-medium text-[#18342A] transition hover:bg-[#03392D]/[0.05] focus-visible:bg-[#03392D]/[0.07] focus-visible:outline-none"
    >
      <span className="text-[#03392D]/70">{icon}</span>
      {children}
    </button>
  );
}
