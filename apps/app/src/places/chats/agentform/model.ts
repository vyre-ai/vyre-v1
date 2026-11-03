// The agent page's rules, with no renderer (DESIGN-chat-system "New agent"): one page to make an agent and to change it. What goes in AGENT.md, what the Can reach list offers for what it does, and how the
// page's fields become the capability's input. The face is a seed, kept on the agent's `face`.
import type { CapMap } from "../../../../../../generated/types.ts";

export type VaultItem = CapMap["vault.items.list"]["out"]["items"][number];
export type ComputerChoice = "none" | "own" | "yours";

export interface AgentDraft { name: string; does: string; face: string; instructions: string; model: string; fallbackModel: string; computer: ComputerChoice; /** The Space AI account for its own work (a Vault handle); empty or absent is Automatic. */ workKey?: string; /** The Chat key: a Space account that pays for every person's chats with this agent instead of their own. Empty or absent is off. */ chatKey?: string }

export const FACES_OFFERED = 6;

/** A fresh seed for the shuffle. */
export function faceSeed(random: () => number = Math.random): string {
  return `pick-${Math.floor(random() * 0xffffff).toString(36)}`;
}

export const faceChoices = (n = FACES_OFFERED, random: () => number = Math.random): string[] => Array.from({ length: n }, () => faceSeed(random));

/** AGENT.md, drafted from what it does. Once the person has written their own, the draft leaves it alone. */
export function draftInstructions(name: string, does: string): string {
  const who = name.trim() === "" ? "this agent" : name.trim();
  const what = does.trim();
  return `# ${who}\n\n${what === "" ? "What you do goes here." : what}\n\n## How you work\n\n- Ask before anything leaves Vyre.\n- Keep what you learn in memory/.\n`;
}

/** Vault items by the words of the search, or those the description names when nothing is typed. */
export function reachOffers(items: readonly VaultItem[], query: string, does: string, picked: readonly string[], limit = 6): VaultItem[] {
  const free = items.filter((i) => !picked.includes(i.id));
  const q = query.trim().toLowerCase();
  if (q !== "") return free.filter((i) => i.name.toLowerCase().includes(q)).slice(0, limit);
  const words = new Set(does.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  return free.filter((i) => i.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => words.has(w))).slice(0, limit);
}

/**
 * The picked items that need a grant (vault.share at Use). A Mine item is never shared, and needs none: the agent's own turn for its person reaches that person's Mine item at Use (vault
 * rulings 62 and 96). Every other item is granted, in a Personal Space too, where the agent is the person's own.
 */
export function grantsFor(picked: readonly VaultItem[]): VaultItem[] {
  return picked.filter((i) => i.scope !== "mine");
}

export function createInput(d: AgentDraft, key: string): CapMap["agents.create"]["in"] {
  return { name: d.name.trim(), ...(d.does.trim() ? { role: d.does.trim() } : {}), ...(d.face ? { face: d.face } : {}), ...(d.model ? { model: d.model } : {}), computer: d.computer === "own", idempotencyKey: key };
}

export function updatePatch(d: AgentDraft): Record<string, unknown> {
  return { name: d.name.trim(), role: d.does.trim(), ...(d.face ? { face: d.face } : {}), model: d.model === "" ? null : d.model, fallbackModel: d.fallbackModel === "" ? null : d.fallbackModel };
}

/** What agents.update gets for the AI account: nothing when it is as saved, null to go back to Automatic, else the Vault handle. */
export function workPatch(workKey: string | undefined, saved: string): { workKey?: string | null } {
  const now = workKey ?? "";
  if (now === saved) return {};
  return { workKey: now === "" ? null : now };
}

/** What agents.update gets for the Chat key: nothing when as saved; on is policy "key" with the account, off is the asker's own again. */
export function chatKeyPatch(chatKey: string | undefined, saved: string): { accountPolicy?: "asker" | "key"; accountKey?: string | null } {
  const now = chatKey ?? "";
  if (now === saved) return {};
  return now === "" ? { accountPolicy: "asker", accountKey: null } : { accountPolicy: "key", accountKey: now };
}
