export type Env = {
  DB: D1Database;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  NOTIFY_SECRET: string;
  ADMIN_PASSWORD?: string;
  TOKEN_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  SITE_ORIGIN?: string;
  /** Public origin used in email links (confirm / unsubscribe). Prefer a custom domain. */
  API_ORIGIN?: string;
  /** Optional Reply-To for deliverability / human contact. */
  REPLY_TO?: string;
};

export async function sendEmail(options: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  unsubscribeUrl?: string;
}): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: options.from,
      to: [options.to],
      subject: options.subject,
      text: options.text,
      html: options.html,
      reply_to: options.replyTo || undefined,
      headers: options.unsubscribeUrl
        ? {
            "List-Unsubscribe": `<${options.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined,
    }),
  });

  const raw = await res.text();
  let parsed: { id?: string; message?: string; name?: string } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    // non-JSON error body
  }

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${raw.slice(0, 300)}`);
  }
  if (!parsed.id) {
    throw new Error(`Resend returned no email id: ${raw.slice(0, 300)}`);
  }
  return { id: parsed.id };
}

const EMAIL_FONT =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function wrapHtml(
  title: string,
  bodyHtml: string,
  footerHtml: string,
  options?: { logoUrl?: string; siteUrl?: string }
): string {
  const logoUrl = options?.logoUrl?.trim();
  const siteUrl = options?.siteUrl?.trim();
  const brand = "What LLMs Can(not) Do";

  const logoBlock = logoUrl
    ? `<tr>
  <td align="center" style="padding: 28px 32px 8px;">
    ${siteUrl ? `<a href="${escapeHtml(siteUrl)}" style="text-decoration: none;">` : ""}
    <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brand)}" width="120" style="display: block; margin: 0 auto; width: 120px; max-width: 120px; height: auto; border: 0;" />
    ${siteUrl ? `</a>` : ""}
  </td>
</tr>
<tr>
  <td align="center" style="padding: 4px 32px 20px; font-family: ${EMAIL_FONT}; font-size: 15px; line-height: 1.3; color: #0f172a; font-weight: 600; letter-spacing: -0.01em;">
    ${escapeHtml(brand)}
  </td>
</tr>
<tr>
  <td style="padding: 0 32px;">
    <div style="height: 1px; background-color: #e2e8f0; line-height: 1px; font-size: 1px;">&nbsp;</div>
  </td>
</tr>`
    : `<tr>
  <td align="center" style="padding: 24px 32px 12px; font-family: ${EMAIL_FONT}; font-size: 15px; line-height: 1.3; color: #0f172a; font-weight: 600;">
    ${siteUrl ? `<a href="${escapeHtml(siteUrl)}" style="color: #0f172a; text-decoration: none;">${escapeHtml(brand)}</a>` : escapeHtml(brand)}
  </td>
</tr>
<tr>
  <td style="padding: 0 32px;">
    <div style="height: 1px; background-color: #e2e8f0; line-height: 1px; font-size: 1px;">&nbsp;</div>
  </td>
</tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; -webkit-text-size-adjust: 100%; font-family: ${EMAIL_FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f1f5f9; margin: 0; padding: 0; font-family: ${EMAIL_FONT};">
    <tr>
      <td align="center" style="padding: 32px 16px; font-family: ${EMAIL_FONT};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; font-family: ${EMAIL_FONT};">
          ${logoBlock}
          <tr>
            <td style="padding: 24px 32px 8px; font-family: ${EMAIL_FONT}; font-size: 16px; line-height: 1.6; color: #334155; text-align: left;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px 28px; font-family: ${EMAIL_FONT};">
              <div style="height: 1px; background-color: #e2e8f0; line-height: 1px; font-size: 1px;">&nbsp;</div>
              <p style="margin: 16px 0 0; font-family: ${EMAIL_FONT}; font-size: 12px; line-height: 1.5; color: #64748b; text-align: center;">
                ${footerHtml}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin: 0 0 1em; font-family: ${EMAIL_FONT}; color: #334155;">${escapeHtml(block).replace(/\n/g, "<br />")}</p>`
    )
    .join("\n");
}

/** Primary CTA button that holds up in common email clients. */
export function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 20px;">
  <tr>
    <td align="center" bgcolor="#0f172a" style="border-radius: 6px;">
      <a href="${escapeHtml(href)}" style="display: inline-block; padding: 12px 22px; font-family: ${EMAIL_FONT}; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">
        ${escapeHtml(label)}
      </a>
    </td>
  </tr>
</table>`;
}
