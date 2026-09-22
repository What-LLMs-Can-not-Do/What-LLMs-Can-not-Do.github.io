import {
  confirmSubscription,
  getByEmail,
  listAllSubscribers,
  listConfirmedForTopic,
  unsubscribeAll,
  upsertSubscription,
} from "./db";
import {
  ctaButton,
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
  return (env.SITE_ORIGIN || "https://what-llms-can-not-do.org").replace(/\/$/, "");
}

function logoUrl(env: Env): string {
  return `${siteOrigin(env)}/logo_cropped.png`;
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
    `<p style="margin: 0 0 1em; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155;">Confirm your subscription to <strong style="color: #0f172a;">What LLMs Can(not) Do</strong> updates.</p>
     ${ctaButton(link, "Confirm subscription")}
     <p style="margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; color: #64748b;">If you did not request this, you can ignore this email.</p>`,
    `<a href="${escapeHtml(site)}" style="color: #64748b;">${escapeHtml(site)}</a>`,
    { logoUrl: logoUrl(env), siteUrl: site }
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
  bodyText: string,
  bodyHtml?: string
): Promise<{ sent: number; failed: number; deliveries: { email: string; id: string }[] }> {
  const recipients = await listConfirmedForTopic(env.DB, topic);
  let sent = 0;
  let failed = 0;
  const deliveries: { email: string; id: string }[] = [];

  for (const row of recipients) {
    const unsub = unsubUrl(env, requestUrl, row.unsub_token);
    const site = siteOrigin(env);
    const text = `${bodyText}\n\n---\nUnsubscribe: ${unsub}\n`;
    const html = wrapHtml(
      subject,
      bodyHtml || textToHtmlParagraphs(bodyText),
      `You received this because you subscribed to <strong>${escapeHtml(topic)}</strong>.
       <a href="${escapeHtml(unsub)}" style="color: #64748b;">Unsubscribe</a>`,
      { logoUrl: logoUrl(env), siteUrl: site }
    );
    try {
      const { id } = await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.FROM_EMAIL,
        to: row.email,
        subject,
        text,
        html,
        unsubscribeUrl: unsub,
      });
      sent++;
      deliveries.push({ email: row.email, id });
      console.log(`Resend accepted news/notify to ${row.email} id=${id}`);
    } catch (err) {
      failed++;
      console.error(`Failed to email ${row.email}:`, err);
    }
  }

  return { sent, failed, deliveries };
}

function notifyIntroHtml(topic: Topic, title: string): string {
  const intro =
    topic === "additions"
      ? "A new entry was added to the What LLMs Can(not) Do table."
      : "An existing entry in the What LLMs Can(not) Do table was updated.";
  return `<p style="margin: 0 0 1em; color: #334155;">${escapeHtml(intro)}</p>
<p style="margin: 0 0 1em; font-size: 18px; font-weight: 600; color: #0f172a;">${escapeHtml(title)}</p>`;
}

function fieldChangeBlocksHtml(
  fieldChanges: { field?: string; before?: string; after?: string }[]
): string {
  const blocks: string[] = [
    `<p style="margin: 0 0 0.75em; font-weight: 600; color: #0f172a;">What changed</p>`,
  ];
  for (const change of fieldChanges) {
    const field = String(change.field || "").trim() || "Field";
    const before = String(change.before ?? "").trim() || "(empty)";
    const after = String(change.after ?? "").trim() || "(empty)";
    blocks.push(`<div style="margin: 0 0 1em; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
  <div style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #0f172a;">${escapeHtml(field)}</div>
  <div style="margin: 0 0 6px; padding: 8px 10px; background: #fef2f2; border-left: 3px solid #dc2626; color: #991b1b; font-size: 14px; line-height: 1.45;">
    <span style="text-decoration: line-through;">${escapeHtml(before)}</span>
  </div>
  <div style="margin: 0; padding: 8px 10px; background: #f0fdf4; border-left: 3px solid #16a34a; color: #166534; font-size: 14px; line-height: 1.45;">
    ${escapeHtml(after)}
  </div>
</div>`);
  }
  return blocks.join("\n");
}

function highlightsHtml(highlights: { field?: string; value?: string }[]): string {
  const items: string[] = [];
  for (const item of highlights) {
    const field = String(item.field || "").trim();
    const value = String(item.value || "").trim();
    if (!field || !value) continue;
    items.push(
      `<li style="margin: 0 0 0.4em;"><strong style="color: #0f172a;">${escapeHtml(field)}:</strong> ${escapeHtml(value)}</li>`
    );
  }
  if (!items.length) return "";
  return `<p style="margin: 0 0 0.5em; font-weight: 600; color: #0f172a;">Entry details</p>
<ul style="margin: 0 0 1em; padding-left: 1.2em; color: #334155;">${items.join("")}</ul>`;
}

function notifyFooterHtml(site: string, prUrl: string): string {
  const parts = [
    `<p style="margin: 0 0 0.5em;"><a href="${escapeHtml(site)}/table" style="color: #2563eb;">Browse the table</a></p>`,
  ];
  if (prUrl) {
    parts.push(
      `<p style="margin: 0;"><a href="${escapeHtml(prUrl)}" style="color: #2563eb;">View pull request</a></p>`
    );
  }
  return parts.join("\n");
}

async function handleSendNews(
  request: Request,
  env: Env,
  requestUrl: URL,
  origin: string | null,
  allowed: string[]
): Promise<Response> {
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

  const subjectRaw = String(body.subject || "").trim();
  const newsBody = String(body.body || "").trim();
  if (!subjectRaw || !newsBody) {
    return jsonResponse(
      { error: "subject and body are required" },
      400,
      origin,
      allowed
    );
  }

  const subject = subjectRaw.replace(/^\[News\]\s*/i, "");
  const subjectLine = `[News] ${subject}`;

  const site = siteOrigin(env);
  const text = `${newsBody}\n\n—\nWhat LLMs Can(not) Do\n${site}`;
  const result = await broadcast(env, requestUrl, "news", subjectLine, text);
  return jsonResponse({ ok: true, topic: "news", subject: subjectLine, ...result }, 200, origin, allowed);
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
        highlights?: { field?: string; value?: string }[];
        field_changes?: { field?: string; before?: string; after?: string }[];
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
        topic === "additions" ? `[Addition] ${title}` : `[Change] ${title}`;

      const lines = [
        topic === "additions"
          ? "A new entry was added to the What LLMs Can(not) Do table."
          : "An existing entry in the What LLMs Can(not) Do table was updated.",
        "",
        title,
      ];

      const fieldChanges = Array.isArray(body.field_changes) ? body.field_changes : [];
      const highlights = Array.isArray(body.highlights) ? body.highlights : [];

      const htmlParts = [notifyIntroHtml(topic, title)];

      if (topic === "changes" && fieldChanges.length) {
        lines.push("", "What changed:");
        for (const change of fieldChanges) {
          const field = String(change.field || "").trim() || "Field";
          const before = String(change.before ?? "").trim() || "(empty)";
          const after = String(change.after ?? "").trim() || "(empty)";
          lines.push("", `• ${field}`, `  − ${before}`, `  + ${after}`);
        }
        htmlParts.push(fieldChangeBlocksHtml(fieldChanges));
      } else if (topic === "additions" && highlights.length) {
        lines.push("", "Entry details:");
        for (const item of highlights) {
          const field = String(item.field || "").trim();
          const value = String(item.value || "").trim();
          if (!field || !value) continue;
          lines.push(`• ${field}: ${value}`);
        }
        htmlParts.push(highlightsHtml(highlights));
      } else if (summary) {
        lines.push("", summary);
        htmlParts.push(
          `<p style="margin: 0 0 1em; color: #334155;">${escapeHtml(summary)}</p>`
        );
      }

      lines.push("", `Browse the table: ${site}/table`);
      if (prUrl) lines.push(`Pull request: ${prUrl}`);
      htmlParts.push(notifyFooterHtml(site, prUrl));

      const bodyText = lines.join("\n");
      const result = await broadcast(env, url, topic, subject, bodyText, htmlParts.join("\n"));
      return jsonResponse({ ok: true, topic, ...result }, 200, origin, allowed);
    }

    if (request.method === "POST" && url.pathname === "/news") {
      if (!requireNotifySecret(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, 401, origin, allowed);
      }
      return handleSendNews(request, env, url, origin, allowed);
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

    if (request.method === "POST" && url.pathname === "/admin/news") {
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
      return handleSendNews(request, env, url, origin, allowed);
    }

    return jsonResponse({ error: "Not found" }, 404, origin, allowed);
  },
};
