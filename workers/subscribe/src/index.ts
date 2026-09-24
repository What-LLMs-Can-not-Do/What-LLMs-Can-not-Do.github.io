import {
  confirmSubscription,
  getByEmail,
  insertPendingEvent,
  listAllSubscribers,
  listConfirmedByFrequency,
  listConfirmedForTopic,
  listPendingEventsSince,
  markDigestSent,
  prunePendingEventsOlderThan,
  subscriberFrequency,
  unsubscribeAll,
  upsertSubscription,
  type NotifyEventInput,
} from "./db";
import {
  escapeHtml,
  sendEmail,
  textToHtmlParagraphs,
  wrapHtml,
  type Env,
} from "./email";
import {
  alreadyDigestedToday,
  frequenciesDueOn,
  normalizeFrequency,
  type Frequency,
} from "./frequencies";
import {
  buildDigestNotifyContent,
  buildSingleNotifyContent,
} from "./notify_content";
import {
  mergePublicTopicsWithInternal,
  normalizePublicTopics,
  parseTopicsJson,
  type Topic,
} from "./topics";
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

/** Origin for confirm/unsubscribe links in emails — must match From-domain brand when possible. */
function apiOrigin(env: Env, requestUrl: URL): string {
  const configured = (env.API_ORIGIN || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return requestUrl.origin;
}

function unsubUrl(env: Env, requestUrl: URL, token: string): string {
  return `${apiOrigin(env, requestUrl)}/unsubscribe?token=${encodeURIComponent(token)}`;
}

function confirmUrl(env: Env, requestUrl: URL, token: string): string {
  return `${apiOrigin(env, requestUrl)}/confirm?token=${encodeURIComponent(token)}`;
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

async function sendConfirmEmail(
  env: Env,
  requestUrl: URL,
  email: string,
  token: string
): Promise<void> {
  const link = confirmUrl(env, requestUrl, token);
  const site = siteOrigin(env);
  const subject = "Please confirm your subscription";
  const text = [
    "Hi,",
    "",
    "Please confirm your email subscription for What LLMs Can(not) Do by opening this link:",
    "",
    link,
    "",
    "If you did not request this, you can ignore this message.",
    "",
    site,
  ].join("\n");
  // Keep confirmation mail minimal — heavy HTML/logo/CTA patterns get spam-scored by some university relays.
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>
<body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 16px; line-height: 1.5; color: #0f172a;">
  <p>Hi,</p>
  <p>Please confirm your email subscription for <strong>What LLMs Can(not) Do</strong>:</p>
  <p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
  <p>If you did not request this, you can ignore this message.</p>
  <p><a href="${escapeHtml(site)}">${escapeHtml(site)}</a></p>
</body>
</html>`;
  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.FROM_EMAIL,
    to: email,
    subject,
    text,
    html,
    replyTo: env.REPLY_TO?.trim() || undefined,
  });
}

async function sendToRecipients(
  env: Env,
  requestUrl: URL,
  recipients: Awaited<ReturnType<typeof listConfirmedForTopic>>,
  topic: Topic,
  subject: string,
  bodyText: string,
  bodyHtml?: string
): Promise<{ sent: number; failed: number; deliveries: { email: string; id: string }[] }> {
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
      { siteUrl: site }
    );
    try {
      const { id } = await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.FROM_EMAIL,
        to: row.email,
        subject,
        text,
        html,
        replyTo: env.REPLY_TO?.trim() || undefined,
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

async function broadcast(
  env: Env,
  requestUrl: URL,
  topic: Topic,
  subject: string,
  bodyText: string,
  bodyHtml?: string,
  frequency?: Frequency
): Promise<{ sent: number; failed: number; deliveries: { email: string; id: string }[] }> {
  const recipients = await listConfirmedForTopic(env.DB, topic, frequency);
  return sendToRecipients(env, requestUrl, recipients, topic, subject, bodyText, bodyHtml);
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

  let body: { subject?: string; body?: string; test?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin, allowed);
  }

  const isTest = Boolean(body.test);
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

  const subject = subjectRaw
    .replace(/^\[Debug\]\s*/i, "")
    .replace(/^\[News\]\s*/i, "");
  const subjectLine = isTest ? `[Debug] [News] ${subject}` : `[News] ${subject}`;

  const site = siteOrigin(env);
  const text = `${newsBody}\n\n—\nWhat LLMs Can(not) Do\n${site}`;
  // News is always sent when composed — frequency only applies to table additions/changes.
  // test: true sends only to the hidden debug topic.
  const result = await broadcast(
    env,
    requestUrl,
    isTest ? "debug" : "news",
    subjectLine,
    text
  );
  return jsonResponse(
    { ok: true, topic: isTest ? "debug" : "news", test: isTest, subject: subjectLine, ...result },
    200,
    origin,
    allowed
  );
}

async function runDigests(
  env: Env,
  requestUrl: URL,
  options?: { forceFrequencies?: Frequency[] }
): Promise<{
  frequencies: Frequency[];
  digests_sent: number;
  failed: number;
  subscribers_touched: number;
}> {
  const now = new Date();
  const due = options?.forceFrequencies?.length
    ? options.forceFrequencies
    : frequenciesDueOn(now);
  const site = siteOrigin(env);
  let digestsSent = 0;
  let failed = 0;
  let subscribersTouched = 0;

  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    console.error("Digest skipped: missing Resend credentials");
    return { frequencies: due, digests_sent: 0, failed: 0, subscribers_touched: 0 };
  }

  for (const frequency of due) {
    if (frequency === "immediate") continue;
    const subscribers = await listConfirmedByFrequency(env.DB, frequency);
    for (const row of subscribers) {
      if (alreadyDigestedToday(row.last_digest_at, now)) continue;

      const since = row.last_digest_at || row.created_at;
      const topics = parseTopicsJson(row.topics_json).filter(
        (t): t is "additions" | "changes" => t === "additions" || t === "changes"
      );
      if (!topics.length) continue;

      let sentAny = false;
      for (const topic of topics) {
        const events = await listPendingEventsSince(env.DB, topic, since);
        const content = buildDigestNotifyContent({
          topic,
          frequency,
          events,
          site,
        });
        if (!content) continue;

        const result = await sendToRecipients(
          env,
          requestUrl,
          [row],
          topic,
          content.subject,
          content.bodyText,
          content.bodyHtml
        );
        digestsSent += result.sent;
        failed += result.failed;
        if (result.sent > 0) sentAny = true;
      }

      if (sentAny) {
        await markDigestSent(env.DB, row.email, now.toISOString());
        subscribersTouched++;
      }
    }
  }

  // Keep roughly a year of events for yearly digests, plus a small buffer.
  const pruneBefore = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
  await prunePendingEventsOlderThan(env.DB, pruneBefore);

  return {
    frequencies: due,
    digests_sent: digestsSent,
    failed,
    subscribers_touched: subscribersTouched,
  };
}

const worker = {
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

      let body: { email?: string; topics?: unknown; frequency?: unknown };
      try {
        body = (await request.json()) as {
          email?: string;
          topics?: unknown;
          frequency?: unknown;
        };
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, origin, allowed);
      }

      const email = normalizeEmail(body.email || "");
      const publicTopics = normalizePublicTopics(body.topics);
      const frequency = normalizeFrequency(body.frequency);
      if (!email) {
        return jsonResponse({ error: "Enter a valid email address." }, 400, origin, allowed);
      }
      if (!publicTopics.length) {
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
      const topics = mergePublicTopicsWithInternal(
        publicTopics,
        existing ? parseTopicsJson(existing.topics_json) : []
      );

      await upsertSubscription(env.DB, {
        email,
        topics,
        frequency,
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
          { ok: true, status: "pending_confirmation", frequency },
          200,
          origin,
          allowed
        );
      }

      return jsonResponse(
        { ok: true, status: "updated", frequency },
        200,
        origin,
        allowed
      );
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
        test?: boolean;
        events?: {
          title?: string;
          summary?: string;
          pr_url?: string;
          highlights?: { field?: string; value?: string }[];
          field_changes?: { field?: string; before?: string; after?: string }[];
        }[];
        highlights?: { field?: string; value?: string }[];
        field_changes?: { field?: string; before?: string; after?: string }[];
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, origin, allowed);
      }

      const isTest = Boolean(body.test);
      const type = String(body.type || "").toLowerCase();
      if (type !== "additions" && type !== "changes") {
        return jsonResponse(
          { error: 'type must be "additions" or "changes"' },
          400,
          origin,
          allowed
        );
      }
      const topic = type as "additions" | "changes";
      const site = siteOrigin(env);

      // Debug aggregate: { test: true, type, events: [...] } → one digest email to debug.
      if (isTest && Array.isArray(body.events) && body.events.length > 0) {
        const pendingLike = body.events.map((event, index) => ({
          id: index + 1,
          topic,
          title: String(event.title || "").trim() || "Table update",
          summary: String(event.summary || "").trim(),
          pr_url: String(event.pr_url || "").trim(),
          highlights_json: JSON.stringify(
            Array.isArray(event.highlights) ? event.highlights : []
          ),
          field_changes_json: JSON.stringify(
            Array.isArray(event.field_changes) ? event.field_changes : []
          ),
          created_at: new Date().toISOString(),
        }));
        const content = buildDigestNotifyContent({
          topic,
          frequency: "weekly",
          events: pendingLike,
          site,
        });
        if (!content) {
          return jsonResponse({ error: "No events to send" }, 400, origin, allowed);
        }
        const subject = `[Debug] ${content.subject}`;
        const result = await broadcast(
          env,
          url,
          "debug",
          subject,
          content.bodyText,
          content.bodyHtml
        );
        return jsonResponse(
          {
            ok: true,
            topic: "debug",
            test: true,
            aggregate: true,
            content_topic: topic,
            event_count: pendingLike.length,
            ...result,
          },
          200,
          origin,
          allowed
        );
      }

      const title = String(body.title || "").trim() || "Table update";
      const summary = String(body.summary || "").trim();
      const prUrl = String(body.pr_url || "").trim();
      const fieldChanges = Array.isArray(body.field_changes) ? body.field_changes : [];
      const highlights = Array.isArray(body.highlights) ? body.highlights : [];

      const content = buildSingleNotifyContent({
        topic,
        title,
        summary,
        prUrl,
        site,
        highlights,
        fieldChanges,
      });
      const subject = isTest ? `[Debug] ${content.subject}` : content.subject;

      if (isTest) {
        // Test sends go only to the hidden debug topic — do not queue for digests.
        const result = await broadcast(
          env,
          url,
          "debug",
          subject,
          content.bodyText,
          content.bodyHtml
        );
        return jsonResponse(
          { ok: true, topic: "debug", test: true, content_topic: topic, ...result },
          200,
          origin,
          allowed
        );
      }

      const event: NotifyEventInput = {
        topic,
        title,
        summary,
        prUrl,
        highlights,
        fieldChanges,
      };
      await insertPendingEvent(env.DB, event);

      const result = await broadcast(
        env,
        url,
        topic,
        subject,
        content.bodyText,
        content.bodyHtml,
        "immediate"
      );
      return jsonResponse(
        { ok: true, topic, queued: true, immediate: result },
        200,
        origin,
        allowed
      );
    }

    if (request.method === "POST" && url.pathname === "/digest") {
      if (!requireNotifySecret(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, 401, origin, allowed);
      }
      let forceFrequencies: Frequency[] | undefined;
      try {
        const body = (await request.json()) as { frequencies?: unknown };
        if (Array.isArray(body.frequencies)) {
          forceFrequencies = body.frequencies
            .map((item) => normalizeFrequency(item))
            .filter((f) => f !== "immediate");
        }
      } catch {
        // empty body is fine — use calendar-due frequencies
      }
      const result = await runDigests(env, url, { forceFrequencies });
      return jsonResponse({ ok: true, ...result }, 200, origin, allowed);
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
        frequency: subscriberFrequency(row),
        confirmed: Boolean(row.confirmed),
        last_digest_at: row.last_digest_at,
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

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const url = new URL(`${apiOrigin(env, new URL("https://subscribe.what-llms-can-not-do.org"))}/`);
    const result = await runDigests(env, url);
    console.log("Digest cron finished", result);
  },
};

export default worker;
