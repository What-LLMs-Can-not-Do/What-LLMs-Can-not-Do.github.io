export type Env = {
  /** Maintainer token for /review/* (list, edit, merge PRs). */
  GITHUB_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  /** Same value as the subscribe worker admin password. */
  ADMIN_PASSWORD?: string;
  GITHUB_REPO?: string;
  ALLOWED_ORIGINS?: string;
};

type GhJson = Record<string, unknown>;

async function gh(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  // GitHub rejects requests without a User-Agent (plain-text "Request forbidden").
  headers.set("User-Agent", "wlcd-contribute-worker");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`https://api.github.com${path}`, { ...init, headers });
}

async function ghJson<T = GhJson>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await gh(token, path, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: unknown }).message)
        : res.statusText;
    let detail = `GitHub API ${res.status}: ${msg}`;
    if (
      res.status === 403 &&
      /resource not accessible|oauthapp|oauth app|organization/i.test(msg)
    ) {
      detail +=
        " — An org owner must approve this OAuth App under " +
        "https://github.com/organizations/What-LLMs-Can-not-Do/settings/oauth_application_policy " +
        "(Third-party access → OAuth app policy), then sign out and sign in again on Contribute.";
    }
    throw new Error(detail);
  }
  return data as T;
}

function contentsPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export async function getFileContent(
  token: string,
  repo: string,
  path: string,
  ref: string
): Promise<{ content: string; sha: string } | null> {
  const res = await gh(
    token,
    `/repos/${repo}/contents/${contentsPath(path)}?ref=${encodeURIComponent(ref)}`
  );
  if (res.status === 404) return null;
  const text = await res.text();
  let data: { encoding?: string; content?: string; sha?: string; message?: string } | null =
    null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`GitHub API ${res.status}: ${text.trim().slice(0, 200) || res.statusText}`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${data?.message || res.statusText}`);
  }
  if (!data || data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error(`Unexpected content encoding for ${path}`);
  }
  // Contents API returns UTF-8 text files as base64 of UTF-8 bytes.
  const binary = atob(data.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const content = new TextDecoder("utf-8").decode(bytes);
  return { content, sha: data.sha as string };
}

export async function fileExists(
  token: string,
  repo: string,
  path: string,
  ref: string
): Promise<boolean> {
  const res = await gh(
    token,
    `/repos/${repo}/contents/${contentsPath(path)}?ref=${encodeURIComponent(ref)}`
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`GitHub API ${res.status}: ${data.message || res.statusText}`);
  }
  return true;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function textToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export type TreeFile =
  | { path: string; content: string; encoding: "utf-8" }
  | { path: string; content: Uint8Array; encoding: "binary" };

export type GhUser = {
  login: string;
  name: string | null;
  avatar_url: string;
};

export async function getAuthenticatedUser(token: string): Promise<GhUser> {
  return ghJson<GhUser>(token, "/user");
}

export async function exchangeOAuthCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "wlcd-contribute-worker",
    },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `OAuth token exchange failed (${res.status})`
    );
  }
  return data.access_token;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Prefer pushing to upstream when the user has write access; otherwise use their fork. */
export async function resolveContributionHead(
  token: string,
  upstreamRepo: string,
  login: string
): Promise<{ headRepo: string; prHeadPrefix: string }> {
  const repoInfo = await ghJson<{
    permissions?: { push?: boolean };
    name: string;
  }>(token, `/repos/${upstreamRepo}`);

  if (repoInfo.permissions?.push) {
    return { headRepo: upstreamRepo, prHeadPrefix: "" };
  }

  const repoName = repoInfo.name || upstreamRepo.split("/")[1];
  const forkFullName = `${login}/${repoName}`;

  const existing = await gh(token, `/repos/${forkFullName}`);
  if (existing.status === 404) {
    await ghJson(token, `/repos/${upstreamRepo}/forks`, {
      method: "POST",
      body: JSON.stringify({ default_branch_only: false }),
    });
  } else if (!existing.ok) {
    const text = await existing.text();
    throw new Error(`GitHub API ${existing.status}: ${text.trim().slice(0, 200)}`);
  }

  for (let i = 0; i < 45; i++) {
    const check = await gh(token, `/repos/${forkFullName}`);
    if (check.ok) {
      return { headRepo: forkFullName, prHeadPrefix: `${login}:` };
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for fork ${forkFullName} to become ready`);
}

export async function createBranchCommitPr(options: {
  token: string;
  /** Upstream repo that receives the pull request. */
  repo: string;
  /** Repo to push the branch to (upstream or the submitter's fork). */
  headRepo?: string;
  /** When pushing to a fork, PR head is `${login}:${branch}`; otherwise just the branch name. */
  prHeadPrefix?: string;
  baseBranch?: string;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: TreeFile[];
  author?: { name: string; email: string };
}): Promise<{ prUrl: string; prNumber: number }> {
  const {
    token,
    repo,
    headRepo = repo,
    prHeadPrefix = "",
    baseBranch = "main",
    branchName,
    commitMessage,
    prTitle,
    prBody,
    files,
    author,
  } = options;

  // Base the contribution on upstream main even when pushing to a fork.
  const ref = await ghJson<{ object: { sha: string } }>(
    token,
    `/repos/${repo}/git/ref/heads/${baseBranch}`
  );
  const baseSha = ref.object.sha;

  const commit = await ghJson<{ tree: { sha: string } }>(
    token,
    `/repos/${repo}/git/commits/${baseSha}`
  );
  const baseTreeSha = commit.tree.sha;

  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];

  for (const file of files) {
    const contentB64 =
      file.encoding === "utf-8"
        ? textToBase64(file.content)
        : toBase64(file.content);

    const blob = await ghJson<{ sha: string }>(token, `/repos/${headRepo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: contentB64, encoding: "base64" }),
    });

    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await ghJson<{ sha: string }>(token, `/repos/${headRepo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });

  const commitBody: Record<string, unknown> = {
    message: commitMessage,
    tree: tree.sha,
    parents: [baseSha],
  };
  if (author) {
    commitBody.author = author;
    commitBody.committer = author;
  }

  const newCommit = await ghJson<{ sha: string }>(token, `/repos/${headRepo}/git/commits`, {
    method: "POST",
    body: JSON.stringify(commitBody),
  });

  await ghJson(token, `/repos/${headRepo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: newCommit.sha,
    }),
  });

  const pr = await ghJson<{ html_url: string; number: number }>(token, `/repos/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: prTitle,
      head: `${prHeadPrefix}${branchName}`,
      base: baseBranch,
      body: prBody,
      maintainer_can_modify: true,
    }),
  });

  return { prUrl: pr.html_url, prNumber: pr.number };
}

export type PullSummary = {
  number: number;
  title: string;
  html_url: string;
  user: { login: string; avatar_url?: string } | null;
  created_at: string;
  updated_at: string;
  head: {
    ref: string;
    sha: string;
    repo: { full_name: string } | null;
  };
  base: {
    ref: string;
    sha: string;
  };
  body: string | null;
  draft: boolean;
  maintainer_can_modify: boolean;
  merged_at?: string | null;
  /** Present on single-PR fetches; null while GitHub computes. */
  mergeable?: boolean | null;
  mergeable_state?: string;
};

export async function listOpenPulls(
  token: string,
  repo: string
): Promise<PullSummary[]> {
  const pulls: PullSummary[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await ghJson<PullSummary[]>(
      token,
      `/repos/${repo}/pulls?state=open&per_page=100&page=${page}&sort=updated&direction=desc`
    );
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  return pulls;
}

/** Closed PRs (merged and unmerged), newest first. Caps pages to bound worker time. */
export async function listClosedPulls(
  token: string,
  repo: string,
  maxPages = 20
): Promise<PullSummary[]> {
  const pulls: PullSummary[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await ghJson<PullSummary[]>(
      token,
      `/repos/${repo}/pulls?state=closed&per_page=100&page=${page}&sort=updated&direction=desc`
    );
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  return pulls;
}

export async function getPull(
  token: string,
  repo: string,
  number: number
): Promise<PullSummary> {
  return ghJson<PullSummary>(token, `/repos/${repo}/pulls/${number}`);
}

export async function updatePull(
  token: string,
  repo: string,
  number: number,
  patch: { title?: string; body?: string }
): Promise<PullSummary> {
  return ghJson<PullSummary>(token, `/repos/${repo}/pulls/${number}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function buildCommitWithFiles(options: {
  token: string;
  /** Repo that receives blobs/commits/refs (PR head repo). */
  headRepo: string;
  /** Commit whose tree is the base_tree and (usually) the parent. */
  parentSha: string;
  /**
   * Optional repo to resolve parentSha/tree from when it lives on upstream
   * but not yet on a fork. Defaults to headRepo.
   */
  parentRepo?: string;
  commitMessage: string;
  files: TreeFile[];
  author?: { name: string; email: string };
}): Promise<string> {
  const {
    token,
    headRepo,
    parentSha,
    parentRepo = headRepo,
    commitMessage,
    files,
    author,
  } = options;

  // Prefer reading the parent commit from headRepo; fall back to parentRepo
  // (upstream) when rewriting a fork branch onto a newer main tip.
  let parentCommit: { tree: { sha: string } };
  try {
    parentCommit = await ghJson<{ tree: { sha: string } }>(
      token,
      `/repos/${headRepo}/git/commits/${parentSha}`
    );
  } catch {
    if (parentRepo === headRepo) throw new Error(`Parent commit ${parentSha} not found in ${headRepo}`);
    parentCommit = await ghJson<{ tree: { sha: string } }>(
      token,
      `/repos/${parentRepo}/git/commits/${parentSha}`
    );
  }
  const baseTreeSha = parentCommit.tree.sha;

  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const file of files) {
    const contentB64 =
      file.encoding === "utf-8" ? textToBase64(file.content) : toBase64(file.content);
    const blob = await ghJson<{ sha: string }>(token, `/repos/${headRepo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: contentB64, encoding: "base64" }),
    });
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  // base_tree must exist in headRepo. If parent was only on upstream, recreate
  // that tree in headRepo by posting the same tree SHA reference via blobs we
  // already have — GitHub accepts base_tree if the tree object is reachable.
  // When parent commit was fetched from upstream only, copy the tree by
  // creating the commit with parents: [parentSha] may fail if parentSha is
  // unknown to headRepo. In that case create an orphan-linked commit is not
  // possible; caller should use same-repo heads or update-branch first.
  let tree: { sha: string };
  try {
    tree = await ghJson<{ sha: string }>(token, `/repos/${headRepo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not build git tree on ${headRepo} from parent ${parentSha.slice(0, 7)}: ${msg}`
    );
  }

  const commitBody: Record<string, unknown> = {
    message: commitMessage,
    tree: tree.sha,
    parents: [parentSha],
  };
  if (author) {
    commitBody.author = author;
    commitBody.committer = author;
  }

  try {
    const newCommit = await ghJson<{ sha: string }>(token, `/repos/${headRepo}/git/commits`, {
      method: "POST",
      body: JSON.stringify(commitBody),
    });
    return newCommit.sha;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not create commit on ${headRepo} with parent ${parentSha.slice(0, 7)}: ${msg}. ` +
        `If this is a fork, main may be too far ahead to rewrite; ask the author to update the branch.`
    );
  }
}

/** Commit file updates on top of an existing branch tip (linear append). */
export async function commitFilesToBranch(options: {
  token: string;
  headRepo: string;
  branchName: string;
  /** Current tip SHA of the branch (parent commit). */
  headSha: string;
  commitMessage: string;
  files: TreeFile[];
  author?: { name: string; email: string };
}): Promise<{ commitSha: string }> {
  const { token, headRepo, branchName, headSha, commitMessage, files, author } = options;

  const commitSha = await buildCommitWithFiles({
    token,
    headRepo,
    parentSha: headSha,
    commitMessage,
    files,
    author,
  });

  await ghJson(token, `/repos/${headRepo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitSha, force: false }),
  });

  return { commitSha };
}

/**
 * Replace a PR branch with a single commit based on upstream base tip.
 * Needed to clear merge conflicts: appending onto a divergent tip still conflicts.
 */
export async function replaceBranchOntoBase(options: {
  token: string;
  /** Upstream repo (has the base branch tip). */
  baseRepo: string;
  headRepo: string;
  branchName: string;
  /** Current tip of the base branch (e.g. main SHA). */
  baseSha: string;
  commitMessage: string;
  files: TreeFile[];
  author?: { name: string; email: string };
}): Promise<{ commitSha: string }> {
  const {
    token,
    baseRepo,
    headRepo,
    branchName,
    baseSha,
    commitMessage,
    files,
    author,
  } = options;

  const commitSha = await buildCommitWithFiles({
    token,
    headRepo,
    parentSha: baseSha,
    parentRepo: baseRepo,
    commitMessage,
    files,
    author,
  });

  await ghJson(token, `/repos/${headRepo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitSha, force: true }),
  });

  return { commitSha };
}

/** Resolve base branch tip SHA. */
export async function getBranchTipSha(
  token: string,
  repo: string,
  branch: string
): Promise<string> {
  const ref = await ghJson<{ object: { sha: string } }>(
    token,
    `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  return ref.object.sha;
}

/** Ask GitHub to merge the base branch into the PR head (may fail on conflicts). */
export async function updatePullBranch(
  token: string,
  repo: string,
  number: number,
  expectedHeadSha?: string
): Promise<{ message: string; url?: string }> {
  const body: Record<string, unknown> = {};
  if (expectedHeadSha) body.expected_head_sha = expectedHeadSha;
  return ghJson(token, `/repos/${repo}/pulls/${number}/update-branch`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function mergePull(options: {
  token: string;
  repo: string;
  number: number;
  commitTitle?: string;
  mergeMethod?: "merge" | "squash" | "rebase";
}): Promise<{ merged: boolean; sha?: string; message: string; html_url?: string }> {
  const { token, repo, number, commitTitle, mergeMethod = "merge" } = options;
  const body: Record<string, unknown> = { merge_method: mergeMethod };
  if (commitTitle) body.commit_title = commitTitle;

  const res = await gh(token, `/repos/${repo}/pulls/${number}/merge`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: { merged?: boolean; sha?: string; message?: string; html_url?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${data.message || res.statusText}`);
  }
  return {
    merged: Boolean(data.merged),
    sha: data.sha,
    message: data.message || "Merged",
    html_url: data.html_url,
  };
}

export function isTableContributionPull(pr: {
  title?: string;
  head?: { ref?: string };
}): boolean {
  const title = (pr.title || "").trim();
  const ref = (pr.head?.ref || "").trim();
  if (/^Table (addition|change):/i.test(title)) return true;
  if (/^Add table entry:/i.test(title) || /^Update table entry/i.test(title)) return true;
  if (ref.startsWith("contribution/")) return true;
  return false;
}

function isBotLogin(login: string): boolean {
  const lower = login.toLowerCase();
  return lower.endsWith("[bot]") || lower === "github-actions" || lower === "dependabot";
}

/** Prefer PR author; fall back to "Submitted by @login" in the body for bot-authored PRs. */
export function contributorLoginFromPull(pr: {
  title?: string;
  body?: string | null;
  user?: { login?: string; avatar_url?: string } | null;
}): { login: string; avatar_url: string } | null {
  const author = (pr.user?.login || "").trim();
  if (author && !isBotLogin(author)) {
    return { login: author, avatar_url: pr.user?.avatar_url || "" };
  }
  const body = pr.body || "";
  const match =
    body.match(/Submitted by\s+\[@([A-Za-z0-9-]+)\]/i) ||
    body.match(/Submitted by\s+@([A-Za-z0-9-]+)/i);
  const fromBody = match?.[1]?.trim();
  if (fromBody && !isBotLogin(fromBody)) {
    return { login: fromBody, avatar_url: "" };
  }
  return null;
}

export function contributionKindFromTitle(title: string): "addition" | "change" | "other" {
  if (/change|update table entry/i.test(title)) return "change";
  if (/addition|add table entry/i.test(title)) return "addition";
  return "other";
}

export type LeaderboardEntry = {
  login: string;
  avatar_url: string;
  total: number;
  additions: number;
  changes: number;
};

export function aggregateContributionLeaderboard(
  pulls: PullSummary[]
): LeaderboardEntry[] {
  const byLogin = new Map<
    string,
    { login: string; avatar_url: string; additions: number; changes: number; other: number }
  >();

  for (const pr of pulls) {
    if (!pr.merged_at) continue;
    if (!isTableContributionPull(pr)) continue;
    const contributor = contributorLoginFromPull(pr);
    if (!contributor) continue;
    const key = contributor.login.toLowerCase();
    let entry = byLogin.get(key);
    if (!entry) {
      entry = {
        login: contributor.login,
        avatar_url: contributor.avatar_url,
        additions: 0,
        changes: 0,
        other: 0,
      };
      byLogin.set(key, entry);
    } else if (!entry.avatar_url && contributor.avatar_url) {
      entry.avatar_url = contributor.avatar_url;
    }
    const kind = contributionKindFromTitle(pr.title || "");
    if (kind === "addition") entry.additions += 1;
    else if (kind === "change") entry.changes += 1;
    else entry.other += 1;
  }

  return [...byLogin.values()]
    .map((entry) => ({
      login: entry.login,
      avatar_url: entry.avatar_url,
      total: entry.additions + entry.changes + entry.other,
      additions: entry.additions,
      changes: entry.changes,
    }))
    .sort((a, b) => b.total - a.total || a.login.localeCompare(b.login));
}
