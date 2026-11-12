// Add to Automations, as data in and data out: which items offer it, the one opening message (an app name and a handle, never a value), and why it cannot start yet.
import type { ItemKind } from "../layout/model.ts";

/** A key, an env block, a login or a loose item can become a connector. A card, a note, a code, an SSH key and an AI account cannot. */
const OFFERS: ReadonlySet<ItemKind> = new Set<ItemKind>(["api_key", "env", "login", "other"]);
export const offersAutomations = (kind: ItemKind): boolean => OFFERS.has(kind);

const SAFE_APP = "this app";
const SECRET_SHAPE = /(sk|pk|rk|ghp|gho|xox[abprs]|eyJ|AKIA|AIza)[-_A-Za-z0-9]{8,}/;
const KEY_WORD = /\s+(?:api[\s_-]*keys?|api[\s_-]*tokens?|access[\s_-]*tokens?|keys?|tokens?|secrets?|credentials?)$/i;

/** The item name as an app name. A name that looks like a pasted key is not repeated. */
export function appNameOf(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") return SAFE_APP;
  if (SECRET_SHAPE.test(trimmed.replace(/\s+/g, ""))) return SAFE_APP;
  // "Notely API key" names the key; the app is Notely. A name that is only the key word stays as it is.
  const cut = trimmed.replace(KEY_WORD, "").trim();
  const app = cut === "" || /^(?:api|access)$/i.test(cut) ? trimmed : cut;
  return app.length > 60 ? `${app.slice(0, 60).trim()}` : app;
}

/** The first message of the session. The skill carries the how; this carries only who and which handle. */
export function connectorOpening(item: { name: string; handle: string }): string {
  return `Add ${appNameOf(item.name)} to Automations. Vault handle ${item.handle}. Load the connector-builder skill. Never ask for the key.`;
}

/** The first message of a session that builds a connector for an app that is not picked yet (the picker's Build a connector row). */
export const BUILD_CONNECTOR_OPENING = "Build a connector for Automations. Ask me which app. Look for its key in the Vault first. Load the connector-builder skill. Never ask me to paste a key in chat.";

export interface AiAccount { state: string }
export type Gate =
  | { state: "ready" }
  | { state: "offline" }
  | { state: "no_use" }
  | { state: "no_ai" }
  | { state: "ai_signin" }
  | { state: "no_builder" }
  | { state: "ask_admin" }
  | { state: "asked" };

/** What stops the session from starting, worst first. A person sees one sentence and one button for it. */
export interface BuilderStatus { allowed: boolean; canGrant: boolean }

export function gateFor(a: { online: boolean; yourLevel: string; accounts: readonly AiAccount[] | null; builder?: BuilderStatus | null; asked?: boolean }): Gate {
  if (!a.online) return { state: "offline" };
  if (a.yourLevel === "view") return { state: "no_use" };
  if (a.accounts === null) return { state: "ready" };
  if (a.accounts.length === 0) return { state: "no_ai" };
  if (!a.accounts.some((x) => x.state === "ok")) return { state: "ai_signin" };
  // building a connector needs connectors.manage, which an assistant gets from the Connector builder role: an admin gives it in one tap, anyone else asks an admin
  if (a.builder && !a.builder.allowed) return a.builder.canGrant ? { state: "no_builder" } : a.asked === true ? { state: "asked" } : { state: "ask_admin" };
  return { state: "ready" };
}

export const GATE_TEXT: Readonly<Record<Exclude<Gate["state"], "ready">, { text: string; fix: string }>> = {
  offline: { text: "The Vault is not reachable, so Vyre cannot use this key yet.", fix: "Try again" },
  no_use: { text: "You can see this item but not use it. Ask for use access first.", fix: "Ask for access" },
  no_ai: { text: "Building a connector runs on your own AI account. Connect one first.", fix: "Connect an AI account" },
  ai_signin: { text: "Your AI account needs signing in again before it can build a connector.", fix: "Sign in again" },
  no_builder: { text: "Your assistant needs permission to build connectors.", fix: "Allow" },
  ask_admin: { text: "Your assistant needs permission to build connectors. An admin can allow it.", fix: "Ask an admin" },
  asked: { text: "An admin has been asked. This turns on when they allow it.", fix: "Check again" },
};

export interface UsedBy { automationId: string; name: string; status: string; steps: { nodeId: string; title: string; blocked?: string }[] }

/** The reply of automations.vault_usage for one item, as the rows to draw. Anything else is no rows. */
export function usedByOf(out: unknown): UsedBy[] {
  const uses = (out as { uses?: unknown } | null)?.uses;
  if (!Array.isArray(uses)) return [];
  const rows: UsedBy[] = [];
  for (const u of uses) {
    const list = (u as { automations?: unknown } | null)?.automations;
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      const r = a as Record<string, unknown> | null;
      if (!r || typeof r["automationId"] !== "string" || typeof r["name"] !== "string") continue;
      const steps = Array.isArray(r["steps"]) ? (r["steps"] as unknown[]).flatMap((x) => {
        const st = x as Record<string, unknown> | null;
        return st && typeof st["nodeId"] === "string" && typeof st["title"] === "string" ? [{ nodeId: st["nodeId"], title: st["title"], ...(typeof st["blocked"] === "string" ? { blocked: st["blocked"] } : {}) }] : [];
      }) : [];
      rows.push({ automationId: r["automationId"], name: r["name"], status: typeof r["status"] === "string" ? r["status"] : "draft", steps });
    }
  }
  return rows;
}

export const stepsLine = (n: number): string => (n === 1 ? "1 step" : `${n} steps`);

/** How many Automations the person cannot open also use the item (vault_usage gives a count for one item they can see, never names). */
export function hiddenOf(out: unknown): number {
  const uses = (out as { uses?: unknown } | null)?.uses;
  if (!Array.isArray(uses)) return 0;
  return uses.reduce((n: number, u) => { const h = (u as { hidden?: unknown } | null)?.hidden; return n + (typeof h === "number" && h > 0 ? h : 0); }, 0);
}

/** The Trash confirm: who stops working, named where the person can open them and counted where they cannot. */
export function trashLine(item: { name: string; handle: string }, names: readonly string[], hidden: number): string {
  const n = names.length + hidden;
  if (n === 0) return `Move ${item.name} to Trash? Agents and Automations that ask for ${item.handle} lose it until you bring it back.`;
  const shown = names.slice(0, 3);
  const parts = [...shown, ...(names.length > shown.length ? [`${names.length - shown.length} more`] : []), ...(hidden > 0 ? [`${hidden} you cannot open`] : [])];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]!;
  return `Move ${item.name} to Trash? ${n === 1 ? "1 automation uses" : `${n} automations use`} this key: ${list}. ${n === 1 ? "It" : "They"} will fail until it is restored or replaced. Agents that ask for ${item.handle} lose it too.`;
}

/** The short note a Used in row shows when one of its steps may no longer send the key to its host ("Not allowed to go to api.example.com"). */
export function blockedNote(u: UsedBy): string | undefined {
  const b = u.steps.find((s) => s.blocked)?.blocked;
  const host = b ? /go to (\S+?)\.(?:\s|$)/.exec(b)?.[1] : undefined;
  return b ? (host ? `Not allowed to go to ${host}` : "A step may no longer use this key") : undefined;
}
