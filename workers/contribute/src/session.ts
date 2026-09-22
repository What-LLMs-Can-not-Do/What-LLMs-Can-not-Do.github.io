/** Signed session cookies for GitHub OAuth access tokens. */

export type GhSession = {
  accessToken: string;
  login: string;
  name: string;
  avatarUrl: string;
  exp: number;
};

const COOKIE_NAME = "wlcd_gh";
const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function sealSession(secret: string, session: GhSession): Promise<string> {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(session)));
  const key = await hmacKey(secret);
  const sig = b64urlEncode(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))
  );
  return `${payload}.${sig}`;
}

export async function unsealSession(
  secret: string,
  sealed: string
): Promise<GhSession | null> {
  const parts = sealed.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(payload)
  );
  if (!ok) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as GhSession;
    if (!session?.accessToken || !session.login || !session.exp) return null;
    if (Date.now() / 1000 > session.exp) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionFromUser(
  accessToken: string,
  user: { login: string; name?: string | null; avatar_url?: string }
): GhSession {
  return {
    accessToken,
    login: user.login,
    name: (user.name || user.login).trim(),
    avatarUrl: user.avatar_url || "",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
}

export function readCookie(request: Request, name = COOKIE_NAME): string | null {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(sealed: string, maxAge = SESSION_TTL_SEC): string {
  // SameSite=None so the site origin can call workers.dev with credentials when allowed.
  // Partitioned (CHIPS) helps Chromium when third-party cookies are restricted.
  return `${COOKIE_NAME}=${encodeURIComponent(sealed)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0`;
}

export async function sealOAuthState(
  secret: string,
  data: { returnTo: string; nonce: string }
): Promise<string> {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(data)));
  const key = await hmacKey(secret);
  const sig = b64urlEncode(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))
  );
  return `${payload}.${sig}`;
}

export async function unsealOAuthState(
  secret: string,
  sealed: string
): Promise<{ returnTo: string; nonce: string } | null> {
  const parts = sealed.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(payload)
  );
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as {
      returnTo: string;
      nonce: string;
    };
    if (!data?.returnTo || !data?.nonce) return null;
    return data;
  } catch {
    return null;
  }
}
