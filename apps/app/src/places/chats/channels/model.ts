// New channel and Browse channels (the pure part): the slug a name becomes, who can be picked, which public channels can be joined, and what an error from the Space says on the sheet.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import type { Agent, Channel } from "../sidebar/model.ts";

export const MAX_NAME = 80;
export type Visibility = "public" | "invite";
export type CreateIn = CapMap["channels.create"]["in"];
export type PrincipalRow = CapMap["access.principals.list"]["out"]["principals"][number];
export type ProjectRow = CapMap["projects.list"]["out"]["projects"][number];

/** What a name becomes as a channel: lower case, words joined by a dash, nothing but letters, digits and dashes ("Rivera Intake!" is rivera-intake). */
export function slugOf(raw: string): string {
  return raw.trim().replace(/^#+/, "").toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-+/, "").slice(0, MAX_NAME).replace(/-+$/, "");
}

/** A key per sheet opening, so a retry after a dropped answer makes the same channel. */
export function createKey(now: number, salt: number): string {
  return `channels.create:${now.toString(36)}${Math.floor(salt * 1e9).toString(36)}`;
}

export interface FormState {
  name: string;
  topic: string;
  visibility: Visibility;
  /** Ids chosen in the picker: `usr_` people and `agt_` agents. */
  picked: readonly string[];
  recordId?: string | undefined;
}

/** The inline problem with the name as typed, or null. Empty is not a problem to show (the Create button waits); a taken name is. */
export function nameProblem(name: string, taken: ReadonlySet<string>): string | null {
  const slug = slugOf(name);
  if (slug === "") return null;
  return taken.has(slug) ? "That name is taken" : null;
}

export function canCreate(f: FormState, taken: ReadonlySet<string>): boolean {
  const slug = slugOf(f.name);
  return slug !== "" && !taken.has(slug);
}

/** The channels.create input: people and agents split by id, empty parts left out. */
export function createInput(f: FormState, idempotencyKey: string): CreateIn {
  const topic = f.topic.trim();
  const memberIds = f.picked.filter((id) => id.startsWith("usr_"));
  const agentIds = f.picked.filter((id) => id.startsWith("agt_"));
  return {
    name: slugOf(f.name), visibility: f.visibility, idempotencyKey,
    ...(topic !== "" ? { topic } : {}), ...(memberIds.length ? { memberIds } : {}), ...(agentIds.length ? { agentIds } : {}), ...(f.recordId ? { recordId: f.recordId } : {}),
  };
}

export interface SheetError { field: "name" | "form"; text: string }

const codeOf = (e: unknown): string => (e as { error?: { code?: string }; code?: string } | null)?.error?.code ?? (e as { code?: string } | null)?.code ?? "";
const messageOf = (e: unknown): string => (e as { error?: { message?: string }; message?: string } | null)?.error?.message ?? (e as { message?: string } | null)?.message ?? "";

/** What a refused create says: a taken name belongs to the name field, a missing permission to the sheet, anything else is a short retry line. */
export function sheetError(e: unknown): SheetError {
  const msg = messageOf(e);
  if (/already exists|taken|duplicate/i.test(msg) || /duplicate/.test(codeOf(e))) return { field: "name", text: "That name is taken" };
  if (/already has a channel/i.test(msg)) return { field: "form", text: "That project already has a channel" };
  if (codeOf(e).startsWith("permission")) return { field: "form", text: "You cannot create channels here" };
  return { field: "form", text: "Could not create. Try again" };
}

/** People first, then agents (the assistant ahead of the rest). You are not in the list: you are always in. */
export function pickEntries(principals: readonly PrincipalRow[], agents: readonly Agent[], meId: string, assistantId: string): { people: PickEntry[]; agents: PickEntry[] } {
  const people: PickEntry[] = principals.filter((p) => p.kind === "person" && p.status === "active" && p.id !== meId).map((p) => ({ id: p.id, name: p.name, kind: "person" as const, ...(p.title ? { sub: p.title } : {}) }));
  const bots: PickEntry[] = agents.map((a) => ({ id: a.agentId, name: a.name, kind: "agent" as const, sub: a.agentId === assistantId ? "Assistant" : "Agent" }));
  bots.sort((a, b) => Number(b.id === assistantId) - Number(a.id === assistantId));
  return { people, agents: bots };
}

/** Public channels you are not in, newest first: what Browse offers. */
export function joinable(channels: readonly Channel[], meId: string): Channel[] {
  return channels.filter((c) => c.visibility === "public" && !c.archived && !c.members.some((m) => m.id === meId)).sort((a, b) => b.createdAt - a.createdAt);
}

/** Names already in use, as the slugs the server compares. */
export function takenNames(channels: readonly Channel[]): Set<string> {
  return new Set(channels.map((c) => slugOf(c.name)));
}
