// Signing in to an AI subscription from the app: press Sign in, the server starts the provider's own sign-in and answers its link, the person approves in their browser, and the account is saved.
// Claude shows a code on its page that is pasted back; ChatGPT and Grok show a code to type there and finish on their own, which the app finds by asking every few seconds. The credential never comes to the app.
import { ownAiRefusal } from "./own-ai.ts";
import type { AiHome } from "./own-ai.ts";
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

/** The sign-ins a Personal Space can take from this computer instead of a fresh sign-in (owner decision D2, 3 Nov 2026). */
export const LOCAL_SIGNINS: readonly { key: string; button: string }[] = [
  { key: "claude-code", button: "Use the Claude Code sign-in on this computer" },
  { key: "codex", button: "Use the Codex sign-in on this computer" },
];

/** Use the sign-in already on this computer: the server reads it and saves it in one go, so the account comes back at once. Rejects with the server's plain line (none there, or not a Personal Space). */
export async function takeLocalSignin(call: Call, providerKey: string, idempotencyKey: string, home: AiHome = "here"): Promise<{ id: string } & Record<string, unknown>> {
  const flow = await startFlow(call, providerKey, idempotencyKey, home, true);
  const done = await checkFlow(call, flow.flowId, undefined, home);
  if (done.state !== "done") throw new Error("The sign-in on this computer could not be saved. Sign in instead.");
  return done.provider;
}

export async function startFlow(call: Call, providerKey: string, idempotencyKey: string, home: AiHome = "here", local = false): Promise<Flow> {
  try {
    const out = await call("providers.subscription_start", { providerKey, idempotencyKey, ...(local ? { local: true } : {}) }) as { flowId: string; instruction: string; url?: string; userCode?: string; needsCode?: boolean };
    return { flowId: out.flowId, instruction: out.instruction, ...(out.url ? { url: out.url } : {}), ...(out.userCode ? { userCode: out.userCode } : {}), needsCode: out.needsCode === true };
  } catch (e) { throw new Error(ownAiRefusal(e, home) ?? words(e, "The sign-in could not start. Check the connection and try again.")); }
}

/** One look at the sign-in. A code the person pasted goes with it. Rejects with a plain line when the provider refused or the sign-in is over. `home` says where the person's own key
 * can be kept from here (own-ai.ts), so a refusal says "locked" only where it can be unlocked. */
export async function checkFlow(call: Call, flowId: string, code?: string, home: AiHome = "here"): Promise<Check> {
  try {
    const out = await call("providers.subscription_complete", { flowId, ...(code ? { code } : {}) }) as { provider?: { id: string } & Record<string, unknown>; waiting?: boolean };
    return out.provider ? { state: "done", provider: out.provider } : { state: "waiting" };
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c === "validation.precondition_failed") return { state: "waiting" };
    const refused = ownAiRefusal(e, home);
    if (refused) throw new Error(refused);
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
