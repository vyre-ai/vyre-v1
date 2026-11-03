// Who the assistant is, for faces. The assistant keeps the shared Vyre mark unless the person picked another look in Settings ("You and your Assistant", Change its look).
// A look is a seed: the face is then drawn from the same Notionists library agents use. Every other agent's face is seeded by its id, never its name, so a rename keeps it.
// One place decides: avatarOf(entity) returns the props every surface hands to <Avatar>.

import type { AvatarKind, AvatarProps } from "./props.ts";

interface State { id: string; look: string; name: string }
let state: State = { id: "", look: "", name: "" };
const listeners = new Set<() => void>();
const KEY = "vyre.assistant.look";

function emit(): void { for (const l of [...listeners]) l(); }

const quote = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The one name a person sees for their own assistant. The server has to keep agent names unique in a Space, so it files the assistant under a default such as "Irfad’s Assistant" or "Assistant 3f9a"; to its
 * person it is Assistant until they rename it. A name they chose is shown as it is.
 */
export function assistantName(name: string, person: string): string {
  const first = person.trim().split(/\s+/)[0] ?? "";
  const owner = first === "" ? "" : `|${quote(first)}(?:['\u2019]s?)?`;
  return new RegExp(`^(?:(?:my${owner}) )?assistant(?: [a-z0-9]+)?$`, "i").test(name.trim()) ? "Assistant" : name;
}

/** The name to show for any agent: the assistant's by the rule above, everyone else's as it is. For a list read straight from the server. */
export const agentName = (id: string, name: string): string => (id === state.id && state.name !== "" ? state.name : name);

/** The open Space's assistant. Called by the shell as it opens a Space; renaming it ("Irfad's Assistant") changes nothing about its face. */
export function setAssistantId(id: string, name = ""): void {
  state = state.name === name ? state : { ...state, name };
  if (state.id === id) return;
  let look = "";
  try { look = globalThis.localStorage?.getItem(`${KEY}:${id}`) ?? ""; } catch { /* no storage: the default mark */ }
  state = { id, look, name };
  emit();
}

/** The look the person chose for the assistant: a seed, or "" / null for the Vyre mark. Kept on this device per assistant. */
export function setAssistantLook(look: string | null): void {
  const next = look ?? "";
  if (state.look === next) return;
  state = { ...state, look: next };
  try { if (state.id) { if (next) globalThis.localStorage?.setItem(`${KEY}:${state.id}`, next); else globalThis.localStorage?.removeItem(`${KEY}:${state.id}`); } } catch { /* not saved */ }
  emit();
}

/** An agent's face stays seeded by its id until someone picks one on its page: a picked seed starts "pick-" (the stored default is only a slug of its name). */
const PICKED = "pick-";
let picked: ReadonlyMap<string, string> = new Map();

export function setAgentFaces(agents: readonly { id: string; face?: string | undefined }[]): void {
  const next = new Map<string, string>();
  for (const a of agents) if (a.face?.startsWith(PICKED) === true) next.set(a.id, a.face);
  if (next.size === picked.size && [...next].every(([id, f]) => picked.get(id) === f)) return;
  picked = next;
  emit();
}

export const pickedFace = (id: string | undefined): string => (id === undefined ? "" : picked.get(id) ?? "");

/** Someone else's private agent (their assistant, an outside agent they connected) wears its person's face to everyone else (owner ruling 3 Nov): agent id to person id. */
let standIns: ReadonlyMap<string, string> = new Map();
export function setStandIns(next: ReadonlyMap<string, string>): void {
  if (next.size === standIns.size && [...next].every(([id, p]) => standIns.get(id) === p)) return;
  standIns = new Map(next);
  emit();
}
/** The person whose face this id wears, or "" when it wears its own. */
export const standInOf = (id: string | undefined): string => (id === undefined ? "" : standIns.get(id) ?? "");
export const assistantId = (): string => state.id;
export const assistantLook = (): string => state.look;
export function subscribeAssistant(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
/** Test seam: forget the assistant and its look. */
export function resetAssistant(): void { state = { id: "", look: "", name: "" }; picked = new Map(); standIns = new Map(); emit(); }

export const isAssistantId = (id: string | undefined): boolean => id !== undefined && id !== "" && id === state.id;

/** Anything that has a face: a person, an agent (the assistant is one) or another kind of thing. */
export interface AvatarEntity { id?: string | undefined; name: string; kind?: AvatarKind | "assistant"; photo?: string | undefined }

/** The props for <Avatar>: the assistant (by id or kind) gets kind "assistant" (the Vyre mark, or its chosen look); an agent is seeded by its id; a person by their id with their photo. */
export function avatarOf(e: AvatarEntity): Pick<AvatarProps, "name" | "seedId" | "kind" | "photo"> {
  const kind: AvatarKind = e.kind === "assistant" || (e.kind === "agent" && isAssistantId(e.id)) ? "assistant" : e.kind ?? "person";
  return { name: e.name, seedId: e.id, kind, ...(e.photo !== undefined ? { photo: e.photo } : {}) };
}
