export type Env = {
  /** Optional bot token (unused for PR authorship; kept for compatibility). */
  GITHUB_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
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
    throw new Error(`GitHub API ${res.status}: ${msg}`);
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
  if (data.encoding !== "base64" || typeof data.content !== "string") {
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
