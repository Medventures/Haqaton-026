/** Format a raw string into a +7 (XXX) XXX-XX-XX mask for KZ/RU numbers. */
export function formatPhoneMask(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  // Normalise a leading 8 or 7 country prefix to 7.
  if (digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (!digits.startsWith("7")) digits = "7" + digits;
  digits = digits.slice(0, 11); // 7 + 10 national digits
  const n = digits.slice(1);
  let out = "+7";
  if (n.length > 0) out += " (" + n.slice(0, 3);
  if (n.length >= 3) out += ")";
  if (n.length > 3) out += " " + n.slice(3, 6);
  if (n.length > 6) out += "-" + n.slice(6, 8);
  if (n.length > 8) out += "-" + n.slice(8, 10);
  return out;
}

/** True when the mask holds a complete 10-digit national number. */
export function isPhoneComplete(masked: string): boolean {
  return masked.replace(/\D/g, "").length === 11;
}
