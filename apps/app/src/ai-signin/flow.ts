// Signing in to an AI subscription from the app: press Sign in, the server starts the provider's own sign-in and answers its link, the person approves in their browser, and the account is saved.
// Claude shows a code on its page that is pasted back; ChatGPT and Grok show a code to type there and finish on their own, which the app finds by asking every few seconds. The credential never comes to the app.
export interface Flow { flowId: string; instruction: string; url?: string; userCode?: string; needsCode: boolean }
export type Check = { state: "waiting" } | { state: "done"; provider: { id: string } & Record<string, unknown> };
export type Call = (cap: string, input?: unknown) => Promise<unknown>;

export const POLL_MS = 3_000;
/** A sign-in the server drops after this long; the app stops asking and says so. */
export const GIVE_UP_MS = 15 * 60_000;

/** The providers that sign in with a button, and how the button reads. */
export const SIGNIN_BUTTONS: readonly { key: string; label: string; button: string }[] = [
  { key: "claude-code", label: "Claude", button: "Sign in with Claude" },
  { key: "codex", label: "ChatGPT", button: "Sign in with ChatGPT" },
  { key: "grok", label: "Grok", button: "Sign in with Grok" },
];

const words = (e: unknown, fallback: string): string => {
  const m = e instanceof Error ? e.message : "";
  // the server's own words for a sign-in problem are plain sentences; anything that looks like a code or a trace is not shown
  return m !== "" && m.length < 240 && !/^[a-z_.]+$/.test(m) ? m : fallback;
};

export async function startFlow(call: Call, providerKey: string, idempotencyKey: string): Promise<Flow> {
  try {
    const out = await call("providers.subscription_start", { providerKey, idempotencyKey }) as { flowId: string; instruction: string; url?: string; userCode?: string; needsCode?: boolean };
    return { flowId: out.flowId, instruction: out.instruction, ...(out.url ? { url: out.url } : {}), ...(out.userCode ? { userCode: out.userCode } : {}), needsCode: out.needsCode === true };
  } catch (e) { throw new Error(words(e, "The sign-in could not start. Check the connection and try again.")); }
}

/** One look at the sign-in. A code the person pasted goes with it. Rejects with a plain line when the provider refused or the sign-in is over. */
export async function checkFlow(call: Call, flowId: string, code?: string): Promise<Check> {
  try {
    const out = await call("providers.subscription_complete", { flowId, ...(code ? { code } : {}) }) as { provider?: { id: string } & Record<string, unknown>; waiting?: boolean };
    return out.provider ? { state: "done", provider: out.provider } : { state: "waiting" };
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c === "validation.precondition_failed") return { state: "waiting" };
    if (c === "auth.unauthenticated") throw new Error("Your Mine Vault is locked on this device. Unlock it, then try again.");
    throw new Error(words(e, "The sign-in did not finish. Start again."));
  }
}

/** The text a person copies from the provider's page: letters, digits and the marks a code carries, as one word. Null when it is not that. */
export function pastedCode(text: string): string | null {
  const t = text.trim();
  return /^[A-Za-z0-9_.~%+=\/#-]{6,600}$/.test(t) ? t : null;
}

/** Only an https address is opened. */
export function safeLink(url: string | undefined): string | null {
  try { const u = new URL(url ?? ""); return u.protocol === "https:" && u.username === "" && u.password === "" ? u.href : null; } catch { return null; }
}

/** The line that tells the person what to do next for this flow. */
export function nextLine(f: Flow): string {
  if (f.needsCode) return "Approve it in your browser, then paste the code.";
  if (f.userCode) return "Open the sign-in and enter this code.";
  return f.instruction;
}
