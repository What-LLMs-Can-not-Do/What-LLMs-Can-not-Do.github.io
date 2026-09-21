export function randomToken(bytes = 24): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(raw: string): string | null {
  const email = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 320) return null;
  // Practical RFC-ish check; Resend will reject invalid addresses too.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
