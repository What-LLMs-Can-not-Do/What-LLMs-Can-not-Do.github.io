import {
  confirmSubscription,
  getByEmail,
  listAllSubscribers,
  listConfirmedForTopic,
  unsubscribeAll,
  upsertSubscription,
} from "./db";
import {
  escapeHtml,
  sendEmail,
  textToHtmlParagraphs,
  wrapHtml,
  type Env,
} from "./email";
import { normalizeTopics, parseTopicsJson, type Topic } from "./topics";
import { normalizeEmail, randomToken } from "./tokens";

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Notify-Secret, X-Admin-Password",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && isAllowedOrigin(origin, allowed)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Exact allowlist match, plus any localhost / 127.0.0.1 port for local Vite. */
function isAllowedOrigin(origin: string, allowed: string[]): boolean {
  if (allowed.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function siteOrigin(env: Env): string {
  return (env.SITE_ORIGIN || "https://what-llms-can-not-do.github.io").replace(/\/$/, "");
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
  allowed: string[]
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, allowed),
    },
  });
}

function requireNotifySecret(request: Request, env: Env): boolean {
  const expected = env.NOTIFY_SECRET?.trim();
  if (!expected) return false;
  const header =
    request.headers.get("X-Notify-Secret") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(header && header === expected);
}

function requireAdminPassword(request: Request, env: Env): boolean {
  const expected = env.ADMIN_PASSWORD?.trim();
  if (!expected) return false;
  const header =
    request.headers.get("X-Admin-Password") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(header && header === expected);
}

function unsubUrl(_env: Env, requestUrl: URL, token: string): string {
  return `${requestUrl.origin}/unsubscribe?token=${encodeURIComponent(token)}`;
}

function confirmUrl(_env: Env, requestUrl: URL, token: string): string {
  return `${requestUrl.origin}/confirm?token=${encodeURIComponent(token)}`;
}

async function sendConfirmEmail(
  env: Env,
  requestUrl: URL,
  email: string,
  token: string
): Promise<void> {
  const link = confirmUrl(env, requestUrl, token);
  const site = siteOrigin(env);
  const subject = "Confirm your WLCD subscription";
  const text = [
    "Confirm your subscription to What LLMs Can(not) Do updates:",
    "",
    link,
    "",
    "If you did not request this, you can ignore this email.",
    `Site: ${site}`,
  ].join("\n");
  const html = wrapHtml(
    subject,
    `<p>Confirm your subscription to <strong>What LLMs Can(not) Do</strong> updates:</p>
     <p><a href="${escapeHtml(link)}">Confirm subscription</a></p>
     <p>If you did not request this, you can ignore this email.</p>`,
    `<a href="${escapeHtml(site)}">${escapeHtml(site)}</a>`
  );
  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.FROM_EMAIL,
    to: email,
    subject,
    text,
    html,
  });
}

async function broadcast(
  env: Env,
  requestUrl: URL,
  topic: Topic,
  subject: string,
  bodyText: string
): Promise<{ sent: number; failed: number }> {
  const recipients = await listConfirmedForTopic(env.DB, topic);
  let sent = 0;
  let failed = 0;

  for (const row of recipients) {
    const unsub = unsubUrl(env, requestUrl, row.unsub_token);
    const text = `${bodyText}\n\n---\nUnsubscribe: ${unsub}\n`;
    const html = wrapHtml(
      subject,
      textToHtmlParagraphs(bodyText),
      `You received this because you subscribed to <strong>${escapeHtml(topic)}</strong>.
       <a href="${escapeHtml(unsub)}">Unsubscribe</a>`
    );
    try {
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.FROM_EMAIL,
        to: row.email,
        subject,
        text,
        html,
        unsubscribeUrl: unsub,
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`Failed to email ${row.email}:`, err);
    }
  }

  return { sent, failed };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (origin && !isAllowedOrigin(origin, allowed)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse({ ok: true, service: "wlcd-subscribe" }, 200, origin, allowed);
    }

    if (request.method === "POST" && url.pathname === "/subscribe") {
      if (origin && !isAllowedOrigin(origin, allowed)) {
        return jsonResponse({ error: "Origin not allowed" }, 403, origin, allowed);
      }
      if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
        return jsonResponse(
          { error: "Server misconfigured: missing Resend credentials" },
          500,
          origin,
          allowed
        );
      }

      let body: { email?: string; topics?: unknown };
      try {
        body = (await request.json()) as { email?: string; topics?: unknown };
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, origin, allowed);
      }

      const email = normalizeEmail(body.email || "");
      const topics = normalizeTopics(body.topics);
      if (!email) {
        return jsonResponse({ error: "Enter a valid email address." }, 400, origin, allowed);
      }
      if (!topics.length) {
        return jsonResponse(
          { error: "Select at least one topic to subscribe to." },
          400,
          origin,
          allowed
        );
      }

      const existing = await getByEmail(env.DB, email);
      const confirmToken = existing?.confirmed ? existing.confirm_token : randomToken();
      const unsubToken = existing?.unsub_token || randomToken();
      const alreadyConfirmed = Boolean(existing?.confirmed);

      await upsertSubscription(env.DB, {
        email,
        topics,
        confirmToken,
        unsubToken,
        confirmed: alreadyConfirmed,
      });

      if (!alreadyConfirmed) {
        try {
          await sendConfirmEmail(env, url, email, confirmToken);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to send confirmation email";
          console.error(message);
          return jsonResponse({ error: message }, 500, origin, allowed);
        }
        return jsonResponse(
          { ok: true, status: "pending_confirmation" },
          200,
          origin,
          allowed
        );
      }

      return jsonResponse({ ok: true, status: "updated" }, 200, origin, allowed);
    }

    if (request.method === "GET" && url.pathname === "/confirm") {
      const token = url.searchParams.get("token") || "";
      const site = siteOrigin(env);
      if (!token) {
        return Response.redirect(`${site}/subscribe?error=missing_token`, 302);
      }
      const row = await confirmSubscription(env.DB, token);
      if (!row) {
        return Response.redirect(`${site}/subscribe?error=invalid_token`, 302);
      }
      return Response.redirect(`${site}/subscribe?confirmed=1`, 302);
    }

    if (request.method === "GET" && url.pathname === "/unsubscribe") {
      const token = url.searchParams.get("token") || "";
      const site = siteOrigin(env);
      if (!token) {
        return Response.redirect(`${site}/subscribe?error=missing_token`, 302);
      }
      const row = await unsubscribeAll(env.DB, token);
      if (!row) {
        return Response.redirect(`${site}/subscribe?error=invalid_token`, 302);
      }
      return Response.redirect(`${site}/subscribe?unsubscribed=1`, 302);
    }

    if (request.method === "POST" && url.pathname === "/unsubscribe") {
      const token = url.searchParams.get("token") || "";
      if (!token) return new Response("Missing token", { status: 400 });
      await unsubscribeAll(env.DB, token);
      return new Response("Unsubscribed", { status: 200 });
    }

    if (request.method === "POST" && url.pathname === "/notify") {
      if (!requireNotifySecret(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, 401, origin, allowed);
      }
      if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
        return jsonResponse(
          { error: "Server misconfigured: missing Resend credentials" },
          500,
          origin,
          allowed
        );
      }

      let body: {
        type?: string;
        title?: string;
        summary?: string;
        pr_url?: string;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, origin, allowed);
      }

      const type = String(body.type || "").toLowerCase();
      if (type !== "additions" && type !== "changes") {
        return jsonResponse(
          { error: 'type must be "additions" or "changes"' },
          400,
          origin,
          allowed
        );
      }
      const topic = type as Topic;
      const title = String(body.title || "").trim() || "Table update";
      const summary = String(body.summary || "").trim();
      const prUrl = String(body.pr_url || "").trim();
      const site = siteOrigin(env);

      const subject =
        topic === "additions"
          ? `WLCD: New table addition — ${title}`
          : `WLCD: Table change — ${title}`;

      const lines = [
        topic === "additions"
          ? "A new entry was added to the What LLMs Can(not) Do table."
          : "An existing entry in the What LLMs Can(not) Do table was updated.",
        "",
        title,
      ];
      if (summary) {
        lines.push("", summary);
      }
      lines.push("", `Browse the table: ${site}/table`);
      if (prUrl) lines.push(`Pull request: ${prUrl}`);

      const bodyText = lines.join("\n");
      const result = await broadcast(env, url, topic, subject, bodyText);
      return jsonResponse({ ok: true, topic, ...result }, 200, origin, allowed);
    }

    if (request.method === "POST" && url.pathname === "/news") {
      if (!requireNotifySecret(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, 401, origin, allowed);
      }
      if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
        return jsonResponse(
          { error: "Server misconfigured: missing Resend credentials" },
          500,
          origin,
          allowed
        );
      }

      let body: { subject?: string; body?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, origin, allowed);
      }

      const subject = String(body.subject || "").trim();
      const newsBody = String(body.body || "").trim();
      if (!subject || !newsBody) {
        return jsonResponse(
          { error: "subject and body are required" },
          400,
          origin,
          allowed
        );
      }

      const site = siteOrigin(env);
      const text = `${newsBody}\n\n—\nWhat LLMs Can(not) Do\n${site}`;
      const result = await broadcast(env, url, "news", subject, text);
      return jsonResponse({ ok: true, topic: "news", ...result }, 200, origin, allowed);
    }

    if (request.method === "GET" && url.pathname === "/admin/subscribers") {
      if (origin && !isAllowedOrigin(origin, allowed)) {
        return jsonResponse({ error: "Origin not allowed" }, 403, origin, allowed);
      }
      if (!env.ADMIN_PASSWORD?.trim()) {
        return jsonResponse(
          { error: "Server misconfigured: missing ADMIN_PASSWORD" },
          500,
          origin,
          allowed
        );
      }
      if (!requireAdminPassword(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, 401, origin, allowed);
      }

      const rows = await listAllSubscribers(env.DB);
      const subscribers = rows.map((row) => ({
        email: row.email,
        topics: parseTopicsJson(row.topics_json),
        confirmed: Boolean(row.confirmed),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
      return jsonResponse(
        { ok: true, count: subscribers.length, subscribers },
        200,
        origin,
        allowed
      );
    }

    return jsonResponse({ error: "Not found" }, 404, origin, allowed);
  },
};
