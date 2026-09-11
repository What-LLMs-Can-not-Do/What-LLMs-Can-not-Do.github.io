import {
  appendDataCsv,
  appendKeywordsCsv,
  appendModelsCsv,
  normalizeAudioName,
  updateDataCsv,
  type ContributionData,
} from "./csv";
import {
  createBranchCommitPr,
  fileExists,
  getFileContent,
  type Env,
  type TreeFile,
} from "./github";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_EXT_RE = /\.(mp3|wav)$/i;

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
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

function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function shortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      if (origin && !allowed.includes(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse({ ok: true, service: "wlcd-contribute" }, 200, origin, allowed);
    }

    if (request.method !== "POST" || url.pathname !== "/contribute") {
      return jsonResponse({ error: "Not found" }, 404, origin, allowed);
    }

    if (origin && !allowed.includes(origin)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, origin, allowed);
    }

    if (!env.GITHUB_TOKEN) {
      return jsonResponse({ error: "Server misconfigured: missing GITHUB_TOKEN" }, 500, origin, allowed);
    }

    const repo = (env.GITHUB_REPO || "What-LLMs-Can-not-Do/What-LLMs-Can-not-Do.github.io").trim();

    try {
      const form = await request.formData();
      const payloadRaw = form.get("payload");
      if (typeof payloadRaw !== "string" || !payloadRaw.trim()) {
        return jsonResponse({ error: "Missing payload field" }, 400, origin, allowed);
      }

      let data: ContributionData;
      try {
        data = JSON.parse(payloadRaw) as ContributionData;
      } catch {
        return jsonResponse({ error: "Invalid JSON payload" }, 400, origin, allowed);
      }

      const contributionType = String(data.contribution_type || "addition").toLowerCase();
      const isChange = contributionType === "change";

      const audioEntries: { name: string; bytes: Uint8Array }[] = [];
      let totalAudio = 0;

      for (const [key, value] of form.entries()) {
        if (key !== "audio") continue;
        if (typeof value === "string") {
          return jsonResponse({ error: "Invalid audio upload" }, 400, origin, allowed);
        }
        const file = value as File;
        const name = file.name || "audio.mp3";
        if (!AUDIO_EXT_RE.test(name)) {
          return jsonResponse(
            { error: `Only .mp3 and .wav audio files are allowed (got ${name})` },
            400,
            origin,
            allowed
          );
        }
        const normalized = normalizeAudioName(name);
        const buf = new Uint8Array(await file.arrayBuffer());
        if (!buf.byteLength) {
          return jsonResponse({ error: `Empty audio file: ${normalized}` }, 400, origin, allowed);
        }
        totalAudio += buf.byteLength;
        if (totalAudio > MAX_AUDIO_BYTES) {
          return jsonResponse(
            { error: "Total audio size exceeds 20 MB limit" },
            400,
            origin,
            allowed
          );
        }
        audioEntries.push({ name: normalized, bytes: buf });
      }

      const baseRef = "main";
      const dataFile = await getFileContent(env.GITHUB_TOKEN, repo, "public/data.csv", baseRef);
      if (!dataFile) {
        return jsonResponse({ error: "Could not read public/data.csv from repo" }, 500, origin, allowed);
      }

      let paperTitle: string;
      let dataCsvText: string;
      if (isChange) {
        const rowId = String(data.ID ?? "").trim();
        const updated = updateDataCsv(dataFile.content, rowId, data);
        dataCsvText = updated.text;
        paperTitle = updated.paperTitle;
      } else {
        const appended = appendDataCsv(dataFile.content, data);
        dataCsvText = appended.text;
        paperTitle = appended.paperTitle;
      }

      const files: TreeFile[] = [{ path: "public/data.csv", content: dataCsvText, encoding: "utf-8" }];

      const modelsFile = await getFileContent(env.GITHUB_TOKEN, repo, "public/models.csv", baseRef);
      const modelsResult = appendModelsCsv(
        modelsFile?.content ?? "",
        (data.new_models as unknown[]) || []
      );
      if (modelsResult.added.length) {
        files.push({ path: "public/models.csv", content: modelsResult.text, encoding: "utf-8" });
      }

      const keywordsFile = await getFileContent(
        env.GITHUB_TOKEN,
        repo,
        "public/keywords.csv",
        baseRef
      );
      const keywordsResult = appendKeywordsCsv(
        keywordsFile?.content ?? "",
        (data.new_keywords as unknown[]) || []
      );
      if (keywordsResult.added.length) {
        files.push({
          path: "public/keywords.csv",
          content: keywordsResult.text,
          encoding: "utf-8",
        });
      }

      for (const audio of audioEntries) {
        const path = `public/audio/${audio.name}`;
        const exists = await fileExists(env.GITHUB_TOKEN, repo, path, baseRef);
        if (exists && !isChange) {
          return jsonResponse(
            { error: `Audio file already exists: ${audio.name}` },
            400,
            origin,
            allowed
          );
        }
        files.push({ path, content: audio.bytes, encoding: "binary" });
      }

      const stamp = Date.now();
      const branchName = `contribution/web-${stamp}-${shortId()}`;
      const kind = isChange ? "change" : "addition";
      const commitMessage = isChange
        ? `Table change: ${paperTitle} (via Contribute form)`
        : `Table addition: ${paperTitle} (via Contribute form)`;
      const prTitle = isChange
        ? `Table change: ${paperTitle}`
        : `Table addition: ${paperTitle}`;

      const extras: string[] = [];
      if (modelsResult.added.length) extras.push(`models: ${modelsResult.added.join(", ")}`);
      if (keywordsResult.added.length) extras.push(`keywords: ${keywordsResult.added.join(", ")}`);
      if (audioEntries.length) extras.push(`audio: ${audioEntries.map((a) => a.name).join(", ")}`);

      const prBody = [
        "## Table contribution",
        "",
        `Automated PR from the Contribute form (${kind}).`,
        "",
        "Please review the updated CSV (and any audio) before merging.",
        extras.length ? "" : null,
        extras.length ? `Also updated: ${extras.join("; ")}.` : null,
      ]
        .filter((line) => line != null)
        .join("\n");

      const { prUrl, prNumber } = await createBranchCommitPr({
        token: env.GITHUB_TOKEN,
        repo,
        branchName,
        commitMessage,
        prTitle,
        prBody,
        files,
      });

      return jsonResponse({ ok: true, pr_url: prUrl, pr_number: prNumber }, 200, origin, allowed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Contribution failed";
      console.error(message);
      return jsonResponse({ error: message }, 500, origin, allowed);
    }
  },
};
