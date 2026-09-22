export type Env = {
  DB: D1Database;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  NOTIFY_SECRET: string;
  ADMIN_PASSWORD?: string;
  TOKEN_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  SITE_ORIGIN?: string;
};

export async function sendEmail(options: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl?: string;
}): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${options.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: options.from,
      to: [options.to],
      subject: options.subject,
      text: options.text,
      html: options.html,
      headers: options.unsubscribeUrl
        ? {
            "List-Unsubscribe": `<${options.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}

export function wrapHtml(title: string, bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #0f172a; max-width: 36rem; margin: 0 auto; padding: 1.5rem;">
  ${bodyHtml}
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 1.5rem 0;" />
  <p style="font-size: 12px; color: #64748b;">${footerHtml}</p>
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
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}
