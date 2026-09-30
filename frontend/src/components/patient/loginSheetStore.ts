import { useSyncExternalStore } from "react";

type SheetState = { open: boolean; redirectTo: string | null };

let state: SheetState = { open: false, redirectTo: null };
const listeners = new Set<() => void>();

function emit(next: SheetState) {
  state = next;
  listeners.forEach((l) => l());
}

export function openLogin(redirectTo: string | null = "/cabinet") {
  emit({ open: true, redirectTo });
}

export function closeLogin() {
  emit({ ...state, open: false });
}

export function useLoginSheet(): SheetState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
