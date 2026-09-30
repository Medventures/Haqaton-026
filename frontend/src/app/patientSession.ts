import { useEffect, useSyncExternalStore } from "react";
import { api, ApiClientError } from "@/api/client";
import type { PatientMe } from "@/api/types";
import { getActor, setOwnerSession } from "@/app/actor";

/**
 * Patient session. Only the opaque owner token is kept in sessionStorage
 * (tab-scoped); profile and medical data are fetched from the API, never persisted.
 */
const TOKEN_KEY = "gc.patient";

type PatientState = {
  status: "anonymous" | "loading" | "ready";
  me: PatientMe | null;
};

let state: PatientState = { status: "anonymous", me: null };
const listeners = new Set<() => void>();
let bootstrapped = false;

function emit(next: PatientState) {
  state = next;
  listeners.forEach((l) => l());
}

async function loadMe() {
  emit({ ...state, status: "loading" });
  try {
    const me = await api.patientMe();
    emit({ status: "ready", me });
  } catch (err) {
    if (err instanceof ApiClientError && (err.status === 401 || err.status === 404)) {
      clearLocal();
      return;
    }
    emit({ status: state.me ? "ready" : "anonymous", me: state.me });
  }
}

function clearLocal() {
  window.sessionStorage.removeItem(TOKEN_KEY);
  if (getActor().role === "patient") setOwnerSession(null, "anonymous");
  emit({ status: "anonymous", me: null });
}

export function bootstrapPatientSession() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;
  const token = window.sessionStorage.getItem(TOKEN_KEY);
  if (!token) return;
  setOwnerSession(token, "patient");
  void loadMe();
}

export type LoginResult =
  | { role: "patient"; me: PatientMe | null }
  | { role: "admin"; token: string };

/** Step 1 of the SMS sign-in: ask the backend to send a code. */
export async function requestOtp(phone: string): Promise<{ retryAfter: number; expiresIn: number }> {
  const res = await api.otpRequest(phone);
  return { retryAfter: res.retry_after, expiresIn: res.expires_in };
}

/** Step 2 of the SMS sign-in: verify the code and start the session. */
export async function verifyOtp(phone: string, code: string): Promise<LoginResult> {
  const session = await api.otpVerify(phone, code);
  if (session.role === "admin") {
    // Staff (clinic) sign-in: never store a patient token; hand off to the staff area.
    setOwnerSession(session.token, "admin");
    window.sessionStorage.setItem("gc.staff", JSON.stringify({ token: session.token, role: "admin" }));
    return { role: "admin", token: session.token };
  }
  window.sessionStorage.setItem(TOKEN_KEY, session.token);
  setOwnerSession(session.token, "patient");
  await loadMe();
  return { role: "patient", me: state.me };
}

export async function loginPatient(phone: string, code: string): Promise<LoginResult> {
  const session = await api.patientLogin(phone, code);
  if (session.role === "admin") {
    // Staff (clinic) sign-in: never store a patient token; hand off to the staff area.
    setOwnerSession(session.token, "admin");
    window.sessionStorage.setItem("gc.staff", JSON.stringify({ token: session.token, role: "admin" }));
    return { role: "admin", token: session.token };
  }
  window.sessionStorage.setItem(TOKEN_KEY, session.token);
  setOwnerSession(session.token, "patient");
  await loadMe();
  return { role: "patient", me: state.me };
}

/** Adopt an owner token issued by booking (POST /api/cases) so the new patient lands in the cabinet. */
export async function adoptPatientSession(token: string): Promise<void> {
  window.sessionStorage.setItem(TOKEN_KEY, token);
  setOwnerSession(token, "patient");
  await loadMe();
}

export async function logoutPatient() {
  try {
    await api.patientLogout();
  } finally {
    clearLocal();
  }
}

export function refreshPatient() {
  if (getActor().role === "patient") void loadMe();
}

export function usePatient(): PatientState {
  useEffect(() => bootstrapPatientSession(), []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toLocaleUpperCase("ru-RU"))
    .join("");
}
