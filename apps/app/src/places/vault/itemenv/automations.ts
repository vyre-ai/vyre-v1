// Add to Automations, as data in and data out: which items offer it, the one opening message (an app name and a handle, never a value), and why it cannot start yet.
import type { ItemKind } from "../layout/model.ts";

/** A key, an env block, a login or a loose item can become a connector. A card, a note, a code, an SSH key and an AI account cannot. */
const OFFERS: ReadonlySet<ItemKind> = new Set<ItemKind>(["api_key", "env", "login", "other"]);
export const offersAutomations = (kind: ItemKind): boolean => OFFERS.has(kind);

const SAFE_APP = "this app";
const SECRET_SHAPE = /(sk|pk|rk|ghp|gho|xox[abprs]|eyJ|AKIA|AIza)[-_A-Za-z0-9]{8,}/;

/** The item name as an app name. A name that looks like a pasted key is not repeated. */
export function appNameOf(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") return SAFE_APP;
  if (SECRET_SHAPE.test(trimmed.replace(/\s+/g, ""))) return SAFE_APP;
  return trimmed.length > 60 ? `${trimmed.slice(0, 60).trim()}` : trimmed;
}

/** The first message of the session. The skill carries the how; this carries only who and which handle. */
export function connectorOpening(item: { name: string; handle: string }): string {
  return `Add ${appNameOf(item.name)} to Automations. Vault handle ${item.handle}. Load the connector-builder skill. Never ask for the key.`;
}

export interface AiAccount { state: string }
export type Gate =
  | { state: "ready" }
  | { state: "offline" }
  | { state: "no_use" }
  | { state: "no_ai" }
  | { state: "ai_signin" };

/** What stops the session from starting, worst first. A person sees one sentence and one button for it. */
export function gateFor(a: { online: boolean; yourLevel: string; accounts: readonly AiAccount[] | null }): Gate {
  if (!a.online) return { state: "offline" };
  if (a.yourLevel === "view") return { state: "no_use" };
  if (a.accounts === null) return { state: "ready" };
  if (a.accounts.length === 0) return { state: "no_ai" };
  if (!a.accounts.some((x) => x.state === "ok")) return { state: "ai_signin" };
  return { state: "ready" };
}

export const GATE_TEXT: Readonly<Record<Exclude<Gate["state"], "ready">, { text: string; fix: string }>> = {
  offline: { text: "The Vault is not reachable, so Vyre cannot use this key yet.", fix: "Try again" },
  no_use: { text: "You can see this item but not use it. Ask for use access first.", fix: "Ask for access" },
  no_ai: { text: "Building a connector runs on your own AI account. Connect one first.", fix: "Connect an AI account" },
  ai_signin: { text: "Your AI account needs signing in again before it can build a connector.", fix: "Sign in again" },
};

export interface UsedBy { automationId: string; name: string; status: string; steps: { nodeId: string; title: string }[] }

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
        return st && typeof st["nodeId"] === "string" && typeof st["title"] === "string" ? [{ nodeId: st["nodeId"], title: st["title"] }] : [];
      }) : [];
      rows.push({ automationId: r["automationId"], name: r["name"], status: typeof r["status"] === "string" ? r["status"] : "draft", steps });
    }
  }
  return rows;
}

export const stepsLine = (n: number): string => (n === 1 ? "1 step" : `${n} steps`);
