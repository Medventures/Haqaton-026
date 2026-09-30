import { createId } from "@/lib/id";

/** One idempotency key per distinct slot booking attempt. Same payload reuses the key. */
export function nextIdempotencyKey(
  currentKey: string | null,
  currentFingerprint: string | null,
  fingerprint: string,
): { key: string; fingerprint: string } {
  if (currentKey && currentFingerprint === fingerprint) {
    return { key: currentKey, fingerprint: currentFingerprint };
  }
  return { key: createId(), fingerprint };
}
