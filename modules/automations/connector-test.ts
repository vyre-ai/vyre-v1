// A safe read of one drafted connector action.
// The Vault fills the key at send time. A key value passed here is dropped.

export interface SafeTestInput {
  method: string;
  path: string;
  domains: readonly string[];
  markedSafe?: boolean;
  vaultItemId: string;
  keyValue?: string;
}

export interface SafeTestPlan {
  method: string;
  url: string;
  vaultItemId: string;
}

export type SafeTestPlanResult =
  | { ok: true; plan: SafeTestPlan }
  | { ok: false; reason: string };

export type SafeTestRun =
  | { level: "tested" }
  | { level: "draft"; reason: string };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MARKED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE", "TRACE"]);

const ONLY_READ = "Only a read can be tried.";
const NO_SERVER = "The document names no server for this read.";
const OTHER_HOST = "That host is not in the document.";
const ONLY_HTTPS = "Only an https address can be tried.";
const HAS_SECRET = "The request address carries a secret.";
const NO_SUCCESS = "The read did not succeed.";

function namedHost(raw: string): string {
  return raw.trim().toLowerCase();
}

function listed(hostname: string, domains: readonly string[]): boolean {
  const host = namedHost(hostname);
  if (host === "") return false;
  return domains.some((domain) => namedHost(domain) === host);
}

export function planSafeTest(input: SafeTestInput): SafeTestPlanResult {
  // Accepted so a caller can hand it over, then discarded. It is not copied.
  void input.keyValue;

  const method = input.method.trim().toUpperCase();
  const marked = input.markedSafe === true;
  if (!READ_METHODS.has(method) && !(marked && MARKED_METHODS.has(method))) {
    return { ok: false, reason: ONLY_READ };
  }

  const domains = input.domains;
  const first = (domains[0] ?? "").trim();
  if (domains.length === 0 || first === "") return { ok: false, reason: NO_SERVER };

  const path = input.path.trim();
  const absolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path);
  if (!absolute && !path.startsWith("/")) return { ok: false, reason: NO_SERVER };

  const raw = absolute ? path : `https://${first}${path}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: absolute ? ONLY_HTTPS : NO_SERVER };
  }
  if (url.protocol !== "https:") return { ok: false, reason: ONLY_HTTPS };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: HAS_SECRET };
  if (absolute) {
    if (!listed(url.hostname, domains)) return { ok: false, reason: OTHER_HOST };
  } else if (namedHost(url.hostname) !== namedHost(first)) {
    return { ok: false, reason: OTHER_HOST };
  }

  return {
    ok: true,
    plan: { method, url: url.href, vaultItemId: input.vaultItemId },
  };
}

export async function runSafeTest(
  plan: SafeTestPlan,
  send: (plan: SafeTestPlan) => Promise<{ status: number }>,
): Promise<SafeTestRun> {
  const outgoing: SafeTestPlan = {
    method: plan.method,
    url: plan.url,
    vaultItemId: plan.vaultItemId,
  };
  try {
    const response = await send(outgoing);
    if (typeof response.status === "number" && response.status >= 200 && response.status <= 299) {
      return { level: "tested" };
    }
  } catch {
    return { level: "draft", reason: NO_SUCCESS };
  }
  return { level: "draft", reason: NO_SUCCESS };
}
