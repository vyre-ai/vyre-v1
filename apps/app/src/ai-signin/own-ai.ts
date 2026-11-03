// A person's own AI accounts and the Space AI key, in words. Two facts decide what a refusal says (ruling 62, and the owner's ruling of 3 Nov that a member's own sign-ins may be kept
// sealed in their Mine on the Space server, opened by signing in):
// - where the Space runs: on this computer (a loopback address, where the local key route can take the key after a password prompt), or elsewhere (a server, where signing in opens it);
// - why it refused: a key that is not open (vault_locked), or a session that ended.
// "Locked, unlock it" is said only where unlocking from this screen works. Everything here is pure except readSpaceAi, which asks the Space two questions.
import { isLoopbackUrl } from "../../../../client/src/gateway/local-key.ts";
import { isVaultLockedError } from "../shell/session/vault-gate.ts";

/**
 * here: the Space runs on this computer; the local key route is reachable and a locked key can be opened from this screen with the password.
 * computer: the desktop app (its own node) talking to a Space that runs elsewhere.
 * none: a browser or a phone talking to a Space that runs elsewhere.
 * Elsewhere ("computer" or "none") the key is opened by signing in to that Space, never by a prompt here.
 */
export type AiHome = "here" | "computer" | "none";

/** From what this app can reach, not from the user agent: the local key route exists only on a loopback Space address, and the own node only in the desktop app (its shell bridge). */
export function aiHomeOf(address: string, ownComputer: boolean): AiHome {
  if (isLoopbackUrl(address)) return "here";
  return ownComputer ? "computer" : "none";
}

/** A key that is not open, where it can be unlocked from this screen. */
export const LOCKED_LINE = "Your Mine Vault is locked on this device. Unlock it, then try again.";
/** A key that is not open on a Space that runs elsewhere: signing in to it opens it. */
export const SIGN_IN_AGAIN_LINE = "Your Mine items open while you are signed in to Vyre. Type your password when Vyre asks for it, then try again.";
/** auth.unauthenticated that is not about the Vault: the session itself ended. */
export const SIGNED_OUT_LINE = "You were signed out. Sign in again, then try again.";

const codeOf = (e: unknown): string => {
  const x = e as { code?: unknown; error?: { code?: unknown } } | null | undefined;
  return typeof x?.code === "string" ? x.code : typeof x?.error?.code === "string" ? x.error.code : "";
};
const messageOf = (e: unknown): string => {
  const x = e as { message?: unknown; error?: { message?: unknown } } | null | undefined;
  return typeof x?.message === "string" ? x.message : typeof x?.error?.message === "string" ? x.error.message : "";
};

/** The Space refused because the person's own key is not open where it asked: by its reason (vault_locked), or in the words older daemons and the connectors module use. */
export function isOwnKeyRefusal(e: unknown): boolean {
  return codeOf(e) === "auth.unauthenticated" && (isVaultLockedError(e) || /vault (key )?is locked/i.test(messageOf(e)));
}

/**
 * The one mapping from a refused save of a person's own AI account (or Mine item) to words. Null when the refusal is not auth.unauthenticated (the caller keeps its own line). "Locked" is
 * said only where unlocking from this screen works; elsewhere signing in opens the key; a session that ended is told to sign in.
 */
export function ownAiRefusal(e: unknown, home: AiHome): string | null {
  if (codeOf(e) !== "auth.unauthenticated") return null;
  if (!isOwnKeyRefusal(e)) return SIGNED_OUT_LINE;
  return home === "here" ? LOCKED_LINE : SIGN_IN_AGAIN_LINE;
}

// ---- the Space AI key, as every "Connect your AI" place shows it

export interface SpaceKeyState { set: boolean; name?: string; state?: "ok" | "failing"; mayManage?: boolean; models?: readonly string[] }
/** Whether the Space covers the person, and who to ask when it does not. Never a dead end: there is always something to do next. */
export interface SpaceAiWords { covered: boolean; title: string; line: string; /** "glm-5.3, kimi-k3 and 5 more" when the key covers the person and lists models; "" otherwise */ models: string }

/** "glm-5.3, kimi-k3 and 5 more" */
export function modelsShort(models: readonly string[] = [], shown = 3): string {
  if (models.length <= shown) return models.join(", ");
  return `${models.slice(0, shown).join(", ")} and ${models.length - shown} more`;
}

/** `key` is null while it loads and "error" when the Space did not answer. `admin` is the name of someone who can add a Space AI key; null when not known. */
export function spaceAiWords(key: SpaceKeyState | null | "error", admin: string | null): SpaceAiWords {
  const ask = admin ? `Ask ${admin}` : "Ask the Space owner or an admin";
  if (key === null) return { covered: false, title: "Checking this Space's AI key", line: "", models: "" };
  if (key === "error") return { covered: false, title: "Could not check this Space's AI key", line: `${ask} whether this Space has one, or connect your own account.`, models: "" };
  const named = key.name ? `This Space's AI key (${key.name})` : "This Space's AI key";
  if (key.set && key.state !== "failing") return { covered: true, title: "You're covered", line: `${named} works for you.`, models: modelsShort(key.models) };
  if (key.set) return { covered: false, title: `${named} stopped working`, line: key.mayManage ? "Check it in Console, under AI." : `${ask} to check it in Console, or connect your own account.`, models: "" };
  if (key.mayManage) return { covered: false, title: "This Space has no AI key yet", line: "Add one in Console, under AI, and it covers everyone here.", models: "" };
  return { covered: false, title: "This Space has no AI key yet", line: `${ask} to add one in Console, or connect your own account.`, models: "" };
}

// ---- reading it

type Call = (cap: string, input?: unknown) => Promise<unknown>;
type PrincipalRow = { id: string; kind: string; name: string; status: string; roles: readonly string[] };

const holds = (p: PrincipalRow, role: string): boolean => p.roles.some((r) => r.toLowerCase().replace(/^rol_/, "") === role);
/** Someone who can add a Space AI key, named with their role: "Irfad Imtiaz (owner)", else an admin. Never the person asking. */
export function adminOf(principals: readonly PrincipalRow[], me?: string): string | null {
  const people = principals.filter((p) => p.kind === "person" && p.status === "active" && p.id !== me && p.name.trim() !== "");
  const owner = people.find((p) => holds(p, "owner"));
  if (owner) return `${owner.name.trim()} (owner)`;
  const admin = people.find((p) => holds(p, "admin"));
  return admin ? `${admin.name.trim()} (admin)` : null;
}

/** The Space AI key's status and who can add one. The key read is required; the people read is a nicety, so a refusal there falls back to `fallbackAdmin`. */
export async function readSpaceAi(call: Call, o: { me?: string; fallbackAdmin?: string | null } = {}): Promise<{ key: SpaceKeyState | "error"; admin: string | null }> {
  const [key, people] = await Promise.all([
    call("providers.space_key.get", {}).then((k) => k as SpaceKeyState, () => "error" as const),
    call("access.principals.list", { kind: "person", status: "active" }).then((x) => (x as { principals?: PrincipalRow[] }).principals ?? [], () => [] as PrincipalRow[]),
  ]);
  return { key, admin: adminOf(people, o.me) ?? o.fallbackAdmin ?? null };
}
