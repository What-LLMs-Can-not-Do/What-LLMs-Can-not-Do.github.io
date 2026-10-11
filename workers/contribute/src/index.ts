import {
  appendDataCsv,
  appendKeywordsCsv,
  appendModelsCsv,
  normalizeAudioName,
  updateDataCsv,
  type ContributionData,
} from "./csv";
import {
  aggregateContributionLeaderboard,
  commitFilesToBranch,
  createBranchCommitPr,
  exchangeOAuthCode,
  fileExists,
  getAuthenticatedUser,
  getFileContent,
  getPull,
  isTableContributionPull,
  listClosedPulls,
  listOpenPulls,
  mergePull,
  resolveContributionHead,
  updatePull,
  type Env,
  type LeaderboardEntry,
  type TreeFile,
} from "./github";
import { findTitledRowIdByPaperTitle, parseContributionFromCsvDiff } from "./review";
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
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

type LeaderboardCache = {
  at: number;
  entries: LeaderboardEntry[];
  merged_prs: number;
};

let leaderboardCache: LeaderboardCache | null = null;

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Password",
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

function repoName(env: Env): string {
  return (env.GITHUB_REPO || "What-LLMs-Can-not-Do/What-LLMs-Can-not-Do.github.io").trim();
}

function parsedBaselineTitleFromPr(title: string | null | undefined): string | null {
  const m = (title || "").match(
    /^(?:Table (?:addition|change)|Add table entry|Update table entry(?: #\d+)?):\s*(.+)$/i
  );
  return m?.[1]?.trim() || null;
}

function requireAdmin(
  request: Request,
  env: Env,
  origin: string | null,
  allowed: string[]
): Response | null {
  const expected = env.ADMIN_PASSWORD?.trim();
  if (!expected) {
    return jsonResponse(
      { error: "Server misconfigured: missing ADMIN_PASSWORD" },
      500,
      origin,
      allowed
    );
  }
  const provided = (request.headers.get("X-Admin-Password") || "").trim();
  if (!provided || provided !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin, allowed);
  }
  return null;
}

function requireReviewToken(
  env: Env,
  origin: string | null,
  allowed: string[]
): { token: string } | Response {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) {
    return jsonResponse(
      { error: "Server misconfigured: missing GITHUB_TOKEN (required for review)" },
      500,
      origin,
      allowed
    );
  }
  return { token };
}

function parsePrNumber(pathname: string): number | null {
  const match = pathname.match(/^\/review\/prs\/(\d+)(?:\/merge)?$/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Rebuild contribution file updates on top of the current base branch tip.
 * For changes, resolves the target row by paper title when possible (IDs shift
 * after other table merges).
 */
async function buildContributionFiles(options: {
  token: string;
  repo: string;
  baseRef: string;
  data: ContributionData;
  audioEntries?: { name: string; bytes: Uint8Array }[];
  /** Prefer this title when looking up the row to change on current main. */
  lookupTitle?: string;
}): Promise<{
  files: TreeFile[];
  paperTitle: string;
  isChange: boolean;
  rowChanged: boolean;
}> {
  const { token, repo, baseRef, data, audioEntries = [], lookupTitle } = options;
  const contributionType = String(data.contribution_type || "addition").toLowerCase();
  const isChange = contributionType === "change";

  const dataFile = await getFileContent(token, repo, "public/data.csv", baseRef);
  if (!dataFile) {
    throw new Error("Could not read public/data.csv from base branch");
  }

  let paperTitle: string;
  let dataCsvText: string;
  let rowChanged = true;

  if (isChange) {
    const titleHint =
      String(lookupTitle || data["Paper title"] || "").trim() ||
      String(data["Paper title"] || "").trim();
    const byTitle = titleHint
      ? findTitledRowIdByPaperTitle(dataFile.content, titleHint)
      : null;
    const rowId = byTitle || String(data.ID ?? "").trim();
    if (!rowId) {
      throw new Error(
        `Could not find table row to update${titleHint ? ` for “${titleHint}”` : ""} on ${baseRef}`
      );
    }
    const updated = updateDataCsv(dataFile.content, rowId, data);
    dataCsvText = updated.text;
    paperTitle = updated.paperTitle;
    rowChanged = updated.changed;
  } else {
    // Avoid duplicating a row that already landed on main under the same title.
    const existingId = findTitledRowIdByPaperTitle(
      dataFile.content,
      String(data["Paper title"] || "")
    );
    if (existingId) {
      const updated = updateDataCsv(dataFile.content, existingId, data);
      dataCsvText = updated.text;
      paperTitle = updated.paperTitle;
      rowChanged = updated.changed;
    } else {
      const appended = appendDataCsv(dataFile.content, data);
      dataCsvText = appended.text;
      paperTitle = appended.paperTitle;
    }
  }

  const modelsFile = await getFileContent(token, repo, "public/models.csv", baseRef);
  const modelsResult = appendModelsCsv(
    modelsFile?.content ?? "",
    (data.new_models as unknown[]) || []
  );
  const keywordsFile = await getFileContent(token, repo, "public/keywords.csv", baseRef);
  const keywordsResult = appendKeywordsCsv(
    keywordsFile?.content ?? "",
    (data.new_keywords as unknown[]) || []
  );

  const files: TreeFile[] = [];
  files.push({ path: "public/data.csv", content: dataCsvText, encoding: "utf-8" });
  if (modelsResult.added.length) {
    files.push({
      path: "public/models.csv",
      content: modelsResult.text,
      encoding: "utf-8",
    });
  } else if (modelsFile) {
    files.push({
      path: "public/models.csv",
      content: modelsFile.content,
      encoding: "utf-8",
    });
  }
  if (keywordsResult.added.length) {
    files.push({
      path: "public/keywords.csv",
      content: keywordsResult.text,
      encoding: "utf-8",
    });
  } else if (keywordsFile) {
    files.push({
      path: "public/keywords.csv",
      content: keywordsFile.content,
      encoding: "utf-8",
    });
  }
  for (const audio of audioEntries) {
    files.push({
      path: `public/audio/${audio.name}`,
      content: audio.bytes,
      encoding: "binary",
    });
  }

  return {
    files,
    paperTitle,
    isChange,
    rowChanged:
      rowChanged ||
      modelsResult.added.length > 0 ||
      keywordsResult.added.length > 0 ||
      audioEntries.length > 0,
  };
}

async function rebasePullOntoBase(options: {
  token: string;
  repo: string;
  pr: Awaited<ReturnType<typeof getPull>>;
  data: ContributionData;
  lookupTitle?: string;
  commitMessage: string;
}): Promise<{ commitSha: string; paperTitle: string }> {
  const { token, repo, pr, data, lookupTitle, commitMessage } = options;
  if (pr.head.repo == null) {
    throw new Error("PR head repository is unavailable (fork deleted?)");
  }
  const baseRef = pr.base.ref || "main";
  const built = await buildContributionFiles({
    token,
    repo,
    baseRef,
    data,
    lookupTitle,
  });
  const { commitSha } = await commitFilesToBranch({
    token,
    headRepo: pr.head.repo.full_name,
    branchName: pr.head.ref,
    headSha: pr.head.sha,
    commitMessage,
    files: built.files,
    author: {
      name: "WLCD Review",
      email: "noreply@what-llms-can-not-do.org",
    },
  });
  return { commitSha, paperTitle: built.paperTitle };
}

async function collectAudioFromForm(
  form: FormData,
  origin: string | null,
  allowed: string[]
): Promise<{ audioEntries: { name: string; bytes: Uint8Array }[] } | Response> {
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

  return { audioEntries };
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

    // --- Public contributor leaderboard ---
    if (request.method === "GET" && url.pathname === "/leaderboard") {
      if (origin && !allowed.includes(origin)) {
        return jsonResponse({ error: "Origin not allowed" }, 403, origin, allowed);
      }
      const tokenOrErr = requireReviewToken(env, origin, allowed);
      if (tokenOrErr instanceof Response) return tokenOrErr;
      const { token } = tokenOrErr;
      const repo = repoName(env);
      const bypassCache = url.searchParams.get("refresh") === "1";

      try {
        const now = Date.now();
        if (
          !bypassCache &&
          leaderboardCache &&
          now - leaderboardCache.at < LEADERBOARD_CACHE_TTL_MS
        ) {
          return jsonResponse(
            {
              ok: true,
              contributors: leaderboardCache.entries,
              merged_prs: leaderboardCache.merged_prs,
              cached: true,
            },
            200,
            origin,
            allowed
          );
        }

        const closed = await listClosedPulls(token, repo);
        const mergedTable = closed.filter(
          (pr) => Boolean(pr.merged_at) && isTableContributionPull(pr)
        );
        const entries = aggregateContributionLeaderboard(mergedTable);
        leaderboardCache = {
          at: now,
          entries,
          merged_prs: mergedTable.length,
        };
        return jsonResponse(
          {
            ok: true,
            contributors: entries,
            merged_prs: mergedTable.length,
            cached: false,
          },
          200,
          origin,
          allowed
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Leaderboard failed";
        console.error(message);
        return jsonResponse({ error: message }, 500, origin, allowed);
      }
    }

    // --- Admin review API ---
    if (url.pathname === "/review/prs" || url.pathname.startsWith("/review/prs/")) {
      if (origin && !allowed.includes(origin)) {
        return jsonResponse({ error: "Origin not allowed" }, 403, origin, allowed);
      }
      const adminErr = requireAdmin(request, env, origin, allowed);
      if (adminErr) return adminErr;
      const tokenOrErr = requireReviewToken(env, origin, allowed);
      if (tokenOrErr instanceof Response) return tokenOrErr;
      const { token } = tokenOrErr;
      const repo = repoName(env);

      try {
        if (request.method === "GET" && url.pathname === "/review/prs") {
          const pulls = await listOpenPulls(token, repo);
          const items = pulls.filter(isTableContributionPull).map((pr) => {
            const title = pr.title || "";
            const kind = /change|update table entry/i.test(title)
              ? "change"
              : /addition|add table entry/i.test(title)
                ? "addition"
                : pr.head.ref.startsWith("contribution/")
                  ? "contribution"
                  : "other";
            return {
              number: pr.number,
              title,
              html_url: pr.html_url,
              user: pr.user?.login || null,
              avatar_url: pr.user?.avatar_url || null,
              created_at: pr.created_at,
              updated_at: pr.updated_at,
              head_ref: pr.head.ref,
              kind,
              draft: Boolean(pr.draft),
            };
          });
          return jsonResponse({ ok: true, pull_requests: items }, 200, origin, allowed);
        }

        const prNumber = parsePrNumber(url.pathname);
        if (!prNumber) {
          return jsonResponse({ error: "Not found" }, 404, origin, allowed);
        }

        if (request.method === "GET" && url.pathname === `/review/prs/${prNumber}`) {
          const pr = await getPull(token, repo, prNumber);
          if (!isTableContributionPull(pr)) {
            return jsonResponse(
              { error: "Pull request is not a table contribution" },
              400,
              origin,
              allowed
            );
          }
          const baseSha = pr.base.sha;
          const headSha = pr.head.sha;
          const headRepo = pr.head.repo?.full_name || repo;

          const [baseData, headData, baseModels, headModels, baseKeywords, headKeywords] =
            await Promise.all([
              getFileContent(token, repo, "public/data.csv", baseSha),
              getFileContent(token, headRepo, "public/data.csv", headSha),
              getFileContent(token, repo, "public/models.csv", baseSha),
              getFileContent(token, headRepo, "public/models.csv", headSha),
              getFileContent(token, repo, "public/keywords.csv", baseSha),
              getFileContent(token, headRepo, "public/keywords.csv", headSha),
            ]);

          if (!baseData || !headData) {
            return jsonResponse(
              { error: "Could not read public/data.csv for this pull request" },
              500,
              origin,
              allowed
            );
          }

          const parsed = parseContributionFromCsvDiff({
            baseDataCsv: baseData.content,
            headDataCsv: headData.content,
            baseModelsCsv: baseModels?.content,
            headModelsCsv: headModels?.content,
            baseKeywordsCsv: baseKeywords?.content,
            headKeywordsCsv: headKeywords?.content,
            prTitle: pr.title || "",
          });

          const payload: ContributionData = {
            contribution_type: parsed.contribution_type,
            ...parsed.form,
          };
          if (parsed.ID) payload.ID = parsed.ID;
          if (parsed.new_models.length) payload.new_models = parsed.new_models;
          if (parsed.new_keywords.length) payload.new_keywords = parsed.new_keywords;

          return jsonResponse(
            {
              ok: true,
              pull_request: {
                number: pr.number,
                title: pr.title,
                html_url: pr.html_url,
                user: pr.user?.login || null,
                avatar_url: pr.user?.avatar_url || null,
                body: pr.body,
                head_ref: pr.head.ref,
                head_sha: pr.head.sha,
                head_repo: headRepo,
                base_ref: pr.base.ref,
                draft: Boolean(pr.draft),
                maintainer_can_modify: Boolean(pr.maintainer_can_modify),
              },
              contribution_type: parsed.contribution_type,
              paper_title: parsed.paper_title,
              payload,
              baseline: parsed.baseline,
            },
            200,
            origin,
            allowed
          );
        }

        if (request.method === "POST" && url.pathname === `/review/prs/${prNumber}`) {
          const pr = await getPull(token, repo, prNumber);
          if (!isTableContributionPull(pr)) {
            return jsonResponse(
              { error: "Pull request is not a table contribution" },
              400,
              origin,
              allowed
            );
          }
          if (pr.head.repo == null) {
            return jsonResponse(
              { error: "PR head repository is unavailable (fork deleted?)" },
              400,
              origin,
              allowed
            );
          }

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

          const audioResult = await collectAudioFromForm(form, origin, allowed);
          if (audioResult instanceof Response) return audioResult;
          const { audioEntries } = audioResult;

          const baseRef = pr.base.ref || "main";
          const built = await buildContributionFiles({
            token,
            repo,
            baseRef,
            data,
            audioEntries,
            lookupTitle:
              String(data["Paper title"] || "").trim() ||
              (parsedBaselineTitleFromPr(pr.title) ?? undefined),
          });

          if (!built.rowChanged) {
            return jsonResponse(
              {
                error:
                  "No changes detected. Edit at least one field (or add models, keywords, or audio) before saving.",
              },
              400,
              origin,
              allowed
            );
          }

          const kind = built.isChange ? "change" : "addition";
          const commitMessage = `Review edit: Table ${kind}: ${built.paperTitle}`;
          const { commitSha } = await commitFilesToBranch({
            token,
            headRepo: pr.head.repo.full_name,
            branchName: pr.head.ref,
            headSha: pr.head.sha,
            commitMessage,
            files: built.files,
            author: {
              name: "WLCD Review",
              email: "noreply@what-llms-can-not-do.org",
            },
          });

          const desiredTitle = built.isChange
            ? `Table change: ${built.paperTitle}`
            : `Table addition: ${built.paperTitle}`;
          if ((pr.title || "") !== desiredTitle) {
            try {
              await updatePull(token, repo, prNumber, { title: desiredTitle });
            } catch (err) {
              console.warn(
                "Failed to update PR title:",
                err instanceof Error ? err.message : err
              );
            }
          }

          return jsonResponse(
            {
              ok: true,
              pr_number: prNumber,
              pr_url: pr.html_url,
              commit_sha: commitSha,
              paper_title: built.paperTitle,
            },
            200,
            origin,
            allowed
          );
        }

        if (request.method === "POST" && url.pathname === `/review/prs/${prNumber}/merge`) {
          let pr = await getPull(token, repo, prNumber);
          if (!isTableContributionPull(pr)) {
            return jsonResponse(
              { error: "Pull request is not a table contribution" },
              400,
              origin,
              allowed
            );
          }

          const tryMerge = async () =>
            mergePull({
              token,
              repo,
              number: prNumber,
              commitTitle: pr.title || undefined,
              mergeMethod: "merge",
            });

          let rebased = false;
          let rebaseSha: string | undefined;
          const needsRebase =
            pr.mergeable === false ||
            pr.mergeable_state === "dirty" ||
            pr.mergeable_state === "unstable";

          const rebaseFromHead = async () => {
            if (pr.head.repo == null) {
              throw new Error("PR head repository is unavailable (fork deleted?)");
            }
            const baseRef = pr.base.ref || "main";
            const headRepo = pr.head.repo.full_name;
            const [baseData, headData, baseModels, headModels, baseKeywords, headKeywords] =
              await Promise.all([
                getFileContent(token, repo, "public/data.csv", baseRef),
                getFileContent(token, headRepo, "public/data.csv", pr.head.sha),
                getFileContent(token, repo, "public/models.csv", baseRef),
                getFileContent(token, headRepo, "public/models.csv", pr.head.sha),
                getFileContent(token, repo, "public/keywords.csv", baseRef),
                getFileContent(token, headRepo, "public/keywords.csv", pr.head.sha),
              ]);
            if (!baseData || !headData) {
              throw new Error("Could not read public/data.csv to resolve merge conflicts");
            }
            const parsed = parseContributionFromCsvDiff({
              baseDataCsv: baseData.content,
              headDataCsv: headData.content,
              baseModelsCsv: baseModels?.content,
              headModelsCsv: headModels?.content,
              baseKeywordsCsv: baseKeywords?.content,
              headKeywordsCsv: headKeywords?.content,
              prTitle: pr.title || "",
            });
            const data: ContributionData = {
              contribution_type: parsed.contribution_type,
              ...parsed.form,
            };
            if (parsed.ID) data.ID = parsed.ID;
            if (parsed.new_models.length) data.new_models = parsed.new_models;
            if (parsed.new_keywords.length) data.new_keywords = parsed.new_keywords;

            const lookupTitle =
              String(parsed.baseline?.["Paper title"] || parsed.form["Paper title"] || "").trim() ||
              parsedBaselineTitleFromPr(pr.title) ||
              undefined;
            const kind = parsed.contribution_type;
            const { commitSha, paperTitle } = await rebasePullOntoBase({
              token,
              repo,
              pr,
              data,
              lookupTitle,
              commitMessage: `Resolve conflicts: Table ${kind}: ${parsed.paper_title}`,
            });
            rebased = true;
            rebaseSha = commitSha;
            // Refresh PR tip after rebase commit.
            pr = await getPull(token, repo, prNumber);
            if (paperTitle && !(pr.title || "").includes(paperTitle)) {
              try {
                const kind = parsed.contribution_type;
                await updatePull(token, repo, prNumber, {
                  title:
                    kind === "change"
                      ? `Table change: ${paperTitle}`
                      : `Table addition: ${paperTitle}`,
                });
              } catch {
                // Non-fatal.
              }
            }
          };

          if (needsRebase) {
            await rebaseFromHead();
          }

          let result;
          try {
            result = await tryMerge();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!rebased && /merge conflict|405/i.test(message)) {
              await rebaseFromHead();
              result = await tryMerge();
            } else if (rebased && /merge conflict|405/i.test(message)) {
              throw new Error(
                "Still has merge conflicts after updating onto main. Open the PR on GitHub to resolve manually."
              );
            } else {
              throw err;
            }
          }

          return jsonResponse(
            {
              ok: true,
              merged: result.merged,
              sha: result.sha,
              message: rebased
                ? `Updated onto main then merged${rebaseSha ? ` (rebase ${rebaseSha.slice(0, 7)})` : ""}.`
                : result.message,
              pr_number: prNumber,
              pr_url: pr.html_url,
              rebased,
            },
            200,
            origin,
            allowed
          );
        }

        return jsonResponse({ error: "Not found" }, 404, origin, allowed);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Review request failed";
        console.error(message);
        return jsonResponse({ error: message }, 500, origin, allowed);
      }
    }

    if (request.method === "GET" && url.pathname === "/auth/me") {
      const session = await loadSession(request, env);
      if (!session) {
        return jsonResponse({ authenticated: false }, 200, origin, allowed);
      }
      // Session seal can outlive a revoked/expired GitHub OAuth token — verify with GitHub.
      try {
        await getAuthenticatedUser(session.accessToken);
      } catch (err) {
        const detail = err instanceof Error ? err.message : "";
        console.warn("auth/me token check failed:", detail);
        return jsonResponse(
          { authenticated: false, reason: "token_invalid" },
          200,
          origin,
          allowed,
          { "Set-Cookie": clearSessionCookie() }
        );
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
      const returnTo = url.searchParams.get("return_to") || "https://what-llms-can-not-do.org/contribute";
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
      if (/401|bad credentials|requires authentication|token.*expired/i.test(message)) {
        return jsonResponse(
          {
            error:
              "Your GitHub sign-in expired or was revoked. Please sign out and sign in again, then resubmit.",
          },
          401,
          origin,
          allowed,
          { "Set-Cookie": clearSessionCookie() }
        );
      }
      return jsonResponse({ error: message }, 500, origin, allowed);
    }
  },
};
