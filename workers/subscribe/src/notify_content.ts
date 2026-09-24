import { escapeHtml } from "./email";
import type { Frequency } from "./frequencies";
import { frequencyLabel } from "./frequencies";
import type { PendingEventRow } from "./db";
import { parseJsonArray } from "./db";
import type { Topic } from "./topics";

export type FieldChange = { field?: string; before?: string; after?: string };
export type Highlight = { field?: string; value?: string };

function displayFieldLabel(field: string): string {
  if (field.startsWith("Open-source")) return "Open-source";
  return field;
}

function formatMultilineHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function notifyIntroHtml(topic: Topic, title: string): string {
  const intro =
    topic === "additions"
      ? "A new entry was added to the What LLMs Can(not) Do table."
      : "An existing entry in the What LLMs Can(not) Do table was updated.";
  return `<p style="margin: 0 0 1em; color: #334155;">${escapeHtml(intro)}</p>
<p style="margin: 0 0 1em; font-size: 18px; font-weight: 600; color: #0f172a;">${escapeHtml(title)}</p>`;
}

export function fieldChangeBlocksHtml(fieldChanges: FieldChange[]): string {
  const blocks: string[] = [
    `<p style="margin: 0 0 0.75em; font-weight: 600; color: #0f172a;">What changed</p>`,
  ];
  for (const change of fieldChanges) {
    const field = displayFieldLabel(String(change.field || "").trim() || "Field");
    const before = String(change.before ?? "").trim() || "(empty)";
    const after = String(change.after ?? "").trim() || "(empty)";
    blocks.push(`<div style="margin: 0 0 1em; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
  <div style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #0f172a;">${escapeHtml(field)}</div>
  <div style="margin: 0 0 6px; padding: 8px 10px; background: #fef2f2; border-left: 3px solid #dc2626; color: #991b1b; font-size: 14px; line-height: 1.45; white-space: pre-wrap;">
    <span style="text-decoration: line-through;">${formatMultilineHtml(before)}</span>
  </div>
  <div style="margin: 0; padding: 8px 10px; background: #f0fdf4; border-left: 3px solid #16a34a; color: #166534; font-size: 14px; line-height: 1.45; white-space: pre-wrap;">
    ${formatMultilineHtml(after)}
  </div>
</div>`);
  }
  return blocks.join("\n");
}

export function highlightsHtml(highlights: Highlight[]): string {
  const blocks: string[] = [];
  for (const item of highlights) {
    const field = displayFieldLabel(String(item.field || "").trim());
    const value = String(item.value || "").trim();
    if (!field || !value) continue;
    if (field === "Summary") {
      blocks.push(`<div style="margin: 0 0 1em;">
  <div style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #0f172a;">${escapeHtml(field)}</div>
  <p style="margin: 0; color: #334155; font-size: 14px; line-height: 1.55; white-space: pre-wrap;">${formatMultilineHtml(value)}</p>
</div>`);
    } else {
      blocks.push(
        `<p style="margin: 0 0 0.55em; color: #334155; font-size: 14px; line-height: 1.45;"><strong style="color: #0f172a;">${escapeHtml(field)}:</strong> ${escapeHtml(value)}</p>`
      );
    }
  }
  if (!blocks.length) return "";
  return `<p style="margin: 0 0 0.75em; font-weight: 600; color: #0f172a;">Entry details</p>
${blocks.join("\n")}`;
}

export function notifyFooterHtml(site: string, prUrl: string): string {
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

export function buildSingleNotifyContent(options: {
  topic: Topic;
  title: string;
  summary: string;
  prUrl: string;
  site: string;
  highlights: Highlight[];
  fieldChanges: FieldChange[];
}): { subject: string; bodyText: string; bodyHtml: string } {
  const { topic, title, summary, prUrl, site, highlights, fieldChanges } = options;
  const subject =
    topic === "additions" ? `[Addition] ${title}` : `[Change] ${title}`;

  const lines = [
    topic === "additions"
      ? "A new entry was added to the What LLMs Can(not) Do table."
      : "An existing entry in the What LLMs Can(not) Do table was updated.",
    "",
    title,
  ];

  const htmlParts = [notifyIntroHtml(topic, title)];

  if (topic === "changes" && fieldChanges.length) {
    lines.push("", "What changed:");
    for (const change of fieldChanges) {
      const field = displayFieldLabel(String(change.field || "").trim() || "Field");
      const before = String(change.before ?? "").trim() || "(empty)";
      const after = String(change.after ?? "").trim() || "(empty)";
      lines.push("", `• ${field}`, `  − ${before}`, `  + ${after}`);
    }
    htmlParts.push(fieldChangeBlocksHtml(fieldChanges));
  } else if (topic === "additions" && highlights.length) {
    lines.push("", "Entry details:");
    for (const item of highlights) {
      const field = displayFieldLabel(String(item.field || "").trim());
      const value = String(item.value || "").trim();
      if (!field || !value) continue;
      lines.push(`• ${field}: ${value}`);
    }
    htmlParts.push(highlightsHtml(highlights));
  } else if (summary) {
    lines.push("", summary);
    htmlParts.push(
      `<div style="margin: 0 0 1em;">
  <div style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #0f172a;">Summary</div>
  <p style="margin: 0; color: #334155; font-size: 14px; line-height: 1.55; white-space: pre-wrap;">${formatMultilineHtml(summary)}</p>
</div>`
    );
  }

  lines.push("", `Browse the table: ${site}/table`);
  if (prUrl) lines.push(`Pull request: ${prUrl}`);
  htmlParts.push(notifyFooterHtml(site, prUrl));

  return {
    subject,
    bodyText: lines.join("\n"),
    bodyHtml: htmlParts.join("\n"),
  };
}

function eventFromRow(row: PendingEventRow): {
  title: string;
  summary: string;
  prUrl: string;
  highlights: Highlight[];
  fieldChanges: FieldChange[];
} {
  return {
    title: row.title,
    summary: row.summary || "",
    prUrl: row.pr_url || "",
    highlights: parseJsonArray<Highlight>(row.highlights_json),
    fieldChanges: parseJsonArray<FieldChange>(row.field_changes_json),
  };
}

export function buildDigestNotifyContent(options: {
  topic: "additions" | "changes";
  frequency: Frequency;
  events: PendingEventRow[];
  site: string;
}): { subject: string; bodyText: string; bodyHtml: string } | null {
  const { topic, frequency, events, site } = options;
  if (!events.length) return null;

  if (events.length === 1) {
    const only = eventFromRow(events[0]);
    return buildSingleNotifyContent({
      topic,
      title: only.title,
      summary: only.summary,
      prUrl: only.prUrl,
      site,
      highlights: only.highlights,
      fieldChanges: only.fieldChanges,
    });
  }

  const label = frequencyLabel(frequency).toLowerCase();
  const count = events.length;
  const subject =
    topic === "additions"
      ? `[Addition] ${count} new entries (${label} digest)`
      : `[Change] ${count} updates (${label} digest)`;

  const intro =
    topic === "additions"
      ? `Here is your ${label} digest of ${count} new table entries.`
      : `Here is your ${label} digest of ${count} table updates.`;

  const lines: string[] = [intro, ""];
  const htmlParts: string[] = [
    `<p style="margin: 0 0 1em; color: #334155;">${escapeHtml(intro)}</p>`,
  ];

  events.forEach((row, index) => {
    const event = eventFromRow(row);
    lines.push(`${index + 1}. ${event.title}`);
    htmlParts.push(
      `<div style="margin: 0 0 1.5em; padding-bottom: 1.25em; border-bottom: 1px solid #e2e8f0;">
  <p style="margin: 0 0 0.75em; font-size: 17px; font-weight: 600; color: #0f172a;">${escapeHtml(event.title)}</p>`
    );

    if (topic === "changes" && event.fieldChanges.length) {
      lines.push("   What changed:");
      for (const change of event.fieldChanges) {
        const field = displayFieldLabel(String(change.field || "").trim() || "Field");
        const before = String(change.before ?? "").trim() || "(empty)";
        const after = String(change.after ?? "").trim() || "(empty)";
        lines.push(`   • ${field}`, `     − ${before}`, `     + ${after}`);
      }
      htmlParts.push(fieldChangeBlocksHtml(event.fieldChanges));
    } else if (topic === "additions" && event.highlights.length) {
      for (const item of event.highlights) {
        const field = displayFieldLabel(String(item.field || "").trim());
        const value = String(item.value || "").trim();
        if (!field || !value) continue;
        lines.push(`   • ${field}: ${value}`);
      }
      htmlParts.push(highlightsHtml(event.highlights));
    } else if (event.summary) {
      lines.push(`   ${event.summary}`);
      htmlParts.push(
        `<div style="margin: 0 0 1em;">
  <div style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #0f172a;">Summary</div>
  <p style="margin: 0; color: #334155; font-size: 14px; line-height: 1.55; white-space: pre-wrap;">${formatMultilineHtml(event.summary)}</p>
</div>`
      );
    }

    if (event.prUrl) {
      lines.push(`   PR: ${event.prUrl}`);
      htmlParts.push(
        `<p style="margin: 0;"><a href="${escapeHtml(event.prUrl)}" style="color: #2563eb;">View pull request</a></p>`
      );
    }

    lines.push("");
    htmlParts.push(`</div>`);
  });

  lines.push(`Browse the table: ${site}/table`);
  htmlParts.push(notifyFooterHtml(site, ""));

  return {
    subject,
    bodyText: lines.join("\n"),
    bodyHtml: htmlParts.join("\n"),
  };
}
