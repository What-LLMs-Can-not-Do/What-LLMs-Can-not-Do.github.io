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
  exchangeOAuthCode,
  fileExists,
  getAuthenticatedUser,
  getFileContent,
  resolveContributionHead,
  type Env,
  type TreeFile,
} from "./github";
import {
  clearSessionCookie,
  readCookie,
  sealOAuthState,
  sealSession,
  sessionFromUser,
  setSessionCookie,
  unsealOAuthState,
  unsealSession,
} from "./session";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_EXT_RE = /\.(mp3|wav)$/i;
const OAUTH_SCOPES = "public_repo read:user";

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin";
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
  allowed: string[],
  extraHeaders: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, allowed),
      ...extraHeaders,
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

function isAllowedReturnTo(returnTo: string, allowedOrigins: string[]): boolean {
  try {
    const url = new URL(returnTo);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const origin = url.origin;
    if (allowedOrigins.includes(origin)) return true;
    // Allow local Vite defaults even if only production origin is configured.
    if (origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173") return true;
    return false;
  } catch {
    return false;
  }
}

async function loadSession(request: Request, env: Env) {
  if (!env.SESSION_SECRET) return null;

  // Prefer Authorization Bearer (cross-site; avoids third-party cookie blocks).
  const auth = request.headers.get("Authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(\S+)/i);
    if (match?.[1]) {
      const fromHeader = await unsealSession(env.SESSION_SECRET, match[1]);
      if (fromHeader) return fromHeader;
    }
  }

  const sealed = readCookie(request);
  if (!sealed) return null;
  return unsealSession(env.SESSION_SECRET, sealed);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (origin && !allowed.includes(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse({ ok: true, service: "wlcd-contribute" }, 200, origin, allowed);
    }

    if (request.method === "GET" && url.pathname === "/auth/me") {
      const session = await loadSession(request, env);
      if (!session) {
        return jsonResponse({ authenticated: false }, 200, origin, allowed);
      }
      return jsonResponse(
        {
          authenticated: true,
          login: session.login,
          name: session.name,
          avatar_url: session.avatarUrl,
        },
        200,
        origin,
        allowed
      );
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      return jsonResponse({ ok: true }, 200, origin, allowed, {
        "Set-Cookie": clearSessionCookie(),
      });
    }

    if (request.method === "GET" && url.pathname === "/auth/login") {
      if (!env.GITHUB_CLIENT_ID || !env.SESSION_SECRET) {
        return jsonResponse(
          { error: "Server misconfigured: missing GitHub OAuth credentials" },
          500,
          origin,
          allowed
        );
      }
      const returnTo = url.searchParams.get("return_to") || "https://what-llms-can-not-do.github.io/contribute";
      if (!isAllowedReturnTo(returnTo, allowed)) {
        return jsonResponse({ error: "Invalid return_to URL" }, 400, origin, allowed);
      }
      const nonce = shortId() + shortId();
      const state = await sealOAuthState(env.SESSION_SECRET, { returnTo, nonce });
      const redirectUri = `${url.origin}/auth/callback`;
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", redirectUri);
      authorize.searchParams.set("scope", OAUTH_SCOPES);
      authorize.searchParams.set("state", state);
      return Response.redirect(authorize.toString(), 302);
    }

    if (request.method === "GET" && url.pathname === "/auth/callback") {
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) {
        return jsonResponse(
          { error: "Server misconfigured: missing GitHub OAuth credentials" },
          500,
          origin,
          allowed
        );
      }
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const parsed = await unsealOAuthState(env.SESSION_SECRET, state);
      if (!code || !parsed || !isAllowedReturnTo(parsed.returnTo, allowed)) {
        return jsonResponse({ error: "Invalid OAuth callback" }, 400, origin, allowed);
      }

      try {
        const redirectUri = `${url.origin}/auth/callback`;
        const accessToken = await exchangeOAuthCode({
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          code,
          redirectUri,
        });
        const user = await getAuthenticatedUser(accessToken);
        const session = sessionFromUser(accessToken, user);
        const sealed = await sealSession(env.SESSION_SECRET, session);
        // Hand the sealed session back via query param so the github.io page can
        // store it locally. Cookies alone fail in many browsers (third-party).
        const dest = new URL(parsed.returnTo);
        dest.searchParams.set("wlcd_gh", sealed);
        return new Response(null, {
          status: 302,
          headers: {
            Location: dest.toString(),
            "Set-Cookie": setSessionCookie(sealed),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "OAuth failed";
        console.error(message);
        return jsonResponse({ error: message }, 500, origin, allowed);
      }
    }

    if (request.method !== "POST" || url.pathname !== "/contribute") {
      return jsonResponse({ error: "Not found" }, 404, origin, allowed);
    }

    if (origin && !allowed.includes(origin)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, origin, allowed);
    }

    if (!env.SESSION_SECRET) {
      return jsonResponse(
        { error: "Server misconfigured: missing SESSION_SECRET" },
        500,
        origin,
        allowed
      );
    }

    const session = await loadSession(request, env);
    if (!session) {
      return jsonResponse(
        { error: "Sign in with GitHub before submitting a contribution." },
        401,
        origin,
        allowed
      );
    }

    const userToken = session.accessToken;
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
      const dataFile = await getFileContent(userToken, repo, "public/data.csv", baseRef);
      if (!dataFile) {
        return jsonResponse({ error: "Could not read public/data.csv from repo" }, 500, origin, allowed);
      }

      let paperTitle: string;
      let dataCsvText: string;
      let rowChanged = true;
      if (isChange) {
        const rowId = String(data.ID ?? "").trim();
        const updated = updateDataCsv(dataFile.content, rowId, data);
        dataCsvText = updated.text;
        paperTitle = updated.paperTitle;
        rowChanged = updated.changed;
      } else {
        const appended = appendDataCsv(dataFile.content, data);
        dataCsvText = appended.text;
        paperTitle = appended.paperTitle;
      }

      const modelsFile = await getFileContent(userToken, repo, "public/models.csv", baseRef);
      const modelsResult = appendModelsCsv(
        modelsFile?.content ?? "",
        (data.new_models as unknown[]) || []
      );

      const keywordsFile = await getFileContent(userToken, repo, "public/keywords.csv", baseRef);
      const keywordsResult = appendKeywordsCsv(
        keywordsFile?.content ?? "",
        (data.new_keywords as unknown[]) || []
      );

      if (
        isChange &&
        !rowChanged &&
        !modelsResult.added.length &&
        !keywordsResult.added.length &&
        !audioEntries.length
      ) {
        return jsonResponse(
          {
            error:
              "No changes detected. Edit at least one field (or add models, keywords, or audio) before submitting.",
          },
          400,
          origin,
          allowed
        );
      }

      const files: TreeFile[] = [];
      if (!isChange || rowChanged) {
        files.push({ path: "public/data.csv", content: dataCsvText, encoding: "utf-8" });
      }
      if (modelsResult.added.length) {
        files.push({ path: "public/models.csv", content: modelsResult.text, encoding: "utf-8" });
      }
      if (keywordsResult.added.length) {
        files.push({
          path: "public/keywords.csv",
          content: keywordsResult.text,
          encoding: "utf-8",
        });
      }

      for (const audio of audioEntries) {
        const path = `public/audio/${audio.name}`;
        const exists = await fileExists(userToken, repo, path, baseRef);
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
        `Submitted by [@${session.login}](https://github.com/${session.login}).`,
        "",
        "Please review the updated CSV (and any audio) before merging.",
        extras.length ? "" : null,
        extras.length ? `Also updated: ${extras.join("; ")}.` : null,
      ]
        .filter((line) => line != null)
        .join("\n");

      const { headRepo, prHeadPrefix } = await resolveContributionHead(
        userToken,
        repo,
        session.login
      );

      const { prUrl, prNumber } = await createBranchCommitPr({
        token: userToken,
        repo,
        headRepo,
        prHeadPrefix,
        branchName,
        commitMessage,
        prTitle,
        prBody,
        files,
        author: {
          name: session.name || session.login,
          email: `${session.login}@users.noreply.github.com`,
        },
      });

      return jsonResponse(
        { ok: true, pr_url: prUrl, pr_number: prNumber, submitted_by: session.login },
        200,
        origin,
        allowed
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Contribution failed";
      console.error(message);
      return jsonResponse({ error: message }, 500, origin, allowed);
    }
  },
};
