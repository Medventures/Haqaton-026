import { useSyncExternalStore } from "react";

export type DemoRole = "anonymous" | "patient" | "coordinator" | "doctor" | "admin";

export const STAFF_ROLES: DemoRole[] = ["coordinator", "doctor", "admin"];

type ActorState = {
  role: DemoRole;
  ownerSession: string | null;
  analyticsSessionId: string | null;
};

let state: ActorState = {
  role: "anonymous",
  ownerSession: null,
  analyticsSessionId: null,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getActor(): ActorState {
  return state;
}

export function setOwnerSession(token: string | null, role: DemoRole) {
  state = { ...state, ownerSession: token, role };
  emit();
}

export function setAnalyticsSessionId(id: string) {
  state = { ...state, analyticsSessionId: id };
  emit();
}

export function useActor(): ActorState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getActor,
    getActor,
  );
}
