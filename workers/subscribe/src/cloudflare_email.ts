/** Cloudflare Email Routing destination addresses (for message.forward). */

export type DestinationEnsureResult = {
  /** API token / account configured. */
  configured: boolean;
  /** Destination exists and has been verified by the mailbox owner. */
  verified: boolean;
  /** We just created the destination (verification email sent by Cloudflare). */
  created: boolean;
  /** Human-readable status for the admin UI. */
  message: string;
};

type CfAddress = {
  id: string;
  email: string;
  verified: string | null;
};

type CfListResponse = {
  success?: boolean;
  errors?: { message?: string }[];
  result?: CfAddress[];
  result_info?: { page?: number; total_pages?: number };
};

type CfCreateResponse = {
  success?: boolean;
  errors?: { message?: string; code?: number }[];
  result?: CfAddress;
};

function apiBase(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/routing/addresses`;
}

async function listDestinations(
  accountId: string,
  apiToken: string
): Promise<CfAddress[]> {
  const all: CfAddress[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const res = await fetch(`${apiBase(accountId)}?page=${page}&per_page=50`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const raw = await res.text();
    let parsed: CfListResponse = {};
    try {
      parsed = JSON.parse(raw) as CfListResponse;
    } catch {
      throw new Error(`Cloudflare list destinations: non-JSON (${res.status})`);
    }
    if (!res.ok || !parsed.success) {
      const msg = parsed.errors?.[0]?.message || raw.slice(0, 200);
      throw new Error(`Cloudflare list destinations failed: ${msg}`);
    }
    all.push(...(parsed.result || []));
    totalPages = Number(parsed.result_info?.total_pages || 1);
    page++;
  }
  return all;
}

/**
 * Ensure `email` is registered as an Email Routing destination.
 * Cloudflare always requires the mailbox owner to click a verification link once;
 * we cannot skip that step via API.
 */
export async function ensureRoutingDestination(options: {
  accountId?: string;
  apiToken?: string;
  email: string;
}): Promise<DestinationEnsureResult> {
  const accountId = options.accountId?.trim();
  const apiToken = options.apiToken?.trim();
  if (!accountId || !apiToken) {
    return {
      configured: false,
      verified: false,
      created: false,
      message:
        "Cloudflare API not configured (set CF_ACCOUNT_ID + CF_API_TOKEN). Add this address manually as an Email Routing destination, then verify it.",
    };
  }

  const normalized = options.email.trim().toLowerCase();
  const existing = (await listDestinations(accountId, apiToken)).find(
    (row) => row.email.trim().toLowerCase() === normalized
  );

  if (existing?.verified) {
    return {
      configured: true,
      verified: true,
      created: false,
      message: "Already verified as an Email Routing destination.",
    };
  }

  if (existing && !existing.verified) {
    return {
      configured: true,
      verified: false,
      created: false,
      message:
        "Destination exists but is not verified yet. Check that inbox for Cloudflare’s verification email (and Spam).",
    };
  }

  const res = await fetch(apiBase(accountId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: normalized }),
  });
  const raw = await res.text();
  let parsed: CfCreateResponse = {};
  try {
    parsed = JSON.parse(raw) as CfCreateResponse;
  } catch {
    throw new Error(`Cloudflare create destination: non-JSON (${res.status})`);
  }

  if (!res.ok || !parsed.success) {
    const msg = parsed.errors?.[0]?.message || raw.slice(0, 200);
    // Race: created elsewhere between list and create.
    if (/already exists|duplicate/i.test(msg)) {
      return {
        configured: true,
        verified: false,
        created: false,
        message:
          "Destination already registered. Check that inbox for Cloudflare’s verification email if forwarding still fails.",
      };
    }
    throw new Error(`Cloudflare create destination failed: ${msg}`);
  }

  const verified = Boolean(parsed.result?.verified);
  return {
    configured: true,
    verified,
    created: true,
    message: verified
      ? "Registered and verified as an Email Routing destination."
      : "Registered with Cloudflare. Check that inbox for a verification email and click the link once.",
  };
}
