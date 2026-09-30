import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CalendarDays,
  Globe,
  Plus,
  Stethoscope,
  UserCog,
  Users,
  BarChart3,
} from "lucide-react";
import { api } from "@/api/client";
import type { StaffPatientRow } from "@/api/types";
import {
  setOwnerSession,
  useActor,
  type DemoRole,
} from "@/app/actor";
import {
  AppShell,
  ShellAccount,
  ShellMenuItem,
  ShellPrimaryButton,
  serifHeading,
  type ShellRecentItem,
} from "@/components/app/AppShell";
import { stageDot, stageShortLabel } from "@/features/staff/format";

type StaffRole = "coordinator" | "doctor" | "admin";

const ROLE_META: Record<StaffRole, { name: string; initials: string }> = {
  admin: { name: "Администратор", initials: "Ад" },
  doctor: { name: "Врач", initials: "Вр" },
  coordinator: { name: "Координатор", initials: "Кр" },
};

const STAFF_TOKEN_KEY = "gc.staff";

type StoredStaff = { token: string; role: StaffRole };

function readStored(): StoredStaff | null {
  try {
    const raw = sessionStorage.getItem(STAFF_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredStaff;
    if (parsed && typeof parsed.token === "string" && (parsed.role === "coordinator" || parsed.role === "doctor" || parsed.role === "admin")) {
      return parsed;
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

function writeStored(value: StoredStaff | null) {
  try {
    if (value) sessionStorage.setItem(STAFF_TOKEN_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STAFF_TOKEN_KEY);
  } catch {
    // ignore quota / disabled storage
  }
}

/** Signed-out gate: Claude-like dark card with three role options. */
function SignInCard({ onEnter, busy }: { onEnter: (role: StaffRole) => void; busy: boolean }) {
  const roleButton = (role: StaffRole, icon: ReactNode, name: string, hint: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onEnter(role)}
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#18201C] px-4 py-4 text-left transition hover:border-[#8BC53F]/40 hover:bg-white/[0.04] disabled:opacity-60"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#8BC53F]/15 text-[#8BC53F]">{icon}</span>
      <span>
        <span className="block text-[15px] font-semibold text-[#E8EFEA]">{name}</span>
        <span className="block text-[13px] text-[#9AABA2]">{hint}</span>
      </span>
    </button>
  );
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#0F1412] px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/[0.07] bg-[#18201C] p-8 text-center">
        <img src="/prime-logo.svg" alt="PRIME Green Clinic" className="mx-auto h-8 w-auto" />
        <h1 className={`${serifHeading} mt-6 text-[26px] text-[#E8EFEA]`}>Рабочее место клиники</h1>
        <p className="mt-2 text-[14px] text-[#9AABA2]">Выберите роль, чтобы открыть рабочее место.</p>
        <div className="mt-6 grid gap-3">
          {roleButton("admin", <UserCog className="h-5 w-5" aria-hidden />, "Администратор", "Полный доступ к рабочему месту")}
          {roleButton("coordinator", <UserCog className="h-5 w-5" aria-hidden />, "Координатор", "Организационный доступ")}
          {roleButton("doctor", <Stethoscope className="h-5 w-5" aria-hidden />, "Врач", "Медицинский доступ")}
        </div>
        <p className="mt-5 text-[12px] text-[#9AABA2]">Вход для сотрудников клиники</p>
      </div>
    </div>
  );
}

export function StaffLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const actor = useActor();
  const { caseId } = useParams();
  const [patients, setPatients] = useState<StaffPatientRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);

  const isStaff = actor.role === "coordinator" || actor.role === "doctor" || actor.role === "admin";

  const enter = useCallback(async (role: StaffRole) => {
    setBusy(true);
    try {
      const session = await api.demoSession(role);
      setOwnerSession(session.token, session.role as DemoRole);
      writeStored({ token: session.token, role });
    } finally {
      setBusy(false);
    }
  }, []);

  // Restore a persisted demo token on first load (token only).
  useEffect(() => {
    if (isStaff) {
      setRestoring(false);
      return;
    }
    const stored = readStored();
    if (stored) {
      setOwnerSession(stored.token, stored.role);
      setRestoring(false);
    } else {
      // Default demo account: admin (coordinator + doctor rights) so the CRM opens straight away.
      void enter("admin").finally(() => setRestoring(false));
    }
    // Only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the sidebar recent list once we have a staff session.
  useEffect(() => {
    if (!isStaff) {
      setPatients([]);
      return;
    }
    let cancelled = false;
    void api
      .staffPatients()
      .then((payload) => {
        if (!cancelled) setPatients(payload.patients);
      })
      .catch(() => {
        if (!cancelled) setPatients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isStaff, actor.ownerSession]);

  const recent: ShellRecentItem[] = useMemo(
    () =>
      patients.map((p) => ({
        key: p.case_id,
        to: `/staff/cases/${p.case_id}`,
        label: p.display_name,
        meta: stageShortLabel(p.stage),
        active: p.case_id === caseId,
        dot: stageDot(p.stage),
      })),
    [patients, caseId],
  );

  if (restoring && !isStaff) {
    return <div className="grid min-h-[100dvh] place-items-center bg-[#0F1412] text-[#9AABA2]">Загрузка…</div>;
  }

  if (!isStaff) {
    return <SignInCard onEnter={(role) => void enter(role)} busy={busy} />;
  }

  const current = (actor.role as StaffRole) in ROLE_META ? (actor.role as StaffRole) : "admin";
  const roleName = ROLE_META[current].name;
  const roleInitials = ROLE_META[current].initials;

  const switchRole = async (role: StaffRole) => {
    await enter(role);
    navigate("/staff");
  };

  return (
    <AppShell
      wide
      theme="dark"
      primaryAction={
        <ShellPrimaryButton icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => navigate("/intake")}>
          Новый клиент
        </ShellPrimaryButton>
      }
      nav={[
        { to: "/staff", label: "Клиенты", icon: <Users className="h-[18px] w-[18px]" aria-hidden />, end: true },
        { to: "/staff/schedule", label: "Расписание", icon: <CalendarDays className="h-[18px] w-[18px]" aria-hidden /> },
        { to: "/staff/funnel", label: "Аналитика", icon: <BarChart3 className="h-[18px] w-[18px]" aria-hidden /> },
      ]}
      recentTitle="Клиенты"
      recent={recent}
      account={
        <ShellAccount initials={roleInitials} name={roleName} subtitle="Рабочее место клиники">
          {(["admin", "doctor", "coordinator"] as StaffRole[])
            .filter((r) => r !== current)
            .map((r) => (
              <ShellMenuItem
                key={r}
                icon={r === "doctor" ? <Stethoscope className="h-[18px] w-[18px]" aria-hidden /> : <UserCog className="h-[18px] w-[18px]" aria-hidden />}
                onClick={() => void switchRole(r)}
              >
                Войти как {r === "admin" ? "администратор" : r === "doctor" ? "врач" : "координатор"}
              </ShellMenuItem>
            ))}
          <ShellMenuItem icon={<Globe className="h-[18px] w-[18px]" aria-hidden />} onClick={() => navigate("/")}>
            На сайт
          </ShellMenuItem>
        </ShellAccount>
      }
    >
      {children}
    </AppShell>
  );
}
