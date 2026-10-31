// Who the assistant is, for faces. The assistant keeps the shared Vyre mark unless the person picked another look in Settings ("You and your Assistant", Change its look).
// A look is a seed: the face is then drawn from the same Notionists library agents use. Every other agent's face is seeded by its id, never its name, so a rename keeps it.
// One place decides: avatarOf(entity) returns the props every surface hands to <Avatar>.

import type { AvatarKind, AvatarProps } from "./props.ts";

interface State { id: string; look: string }
let state: State = { id: "", look: "" };
const listeners = new Set<() => void>();
const KEY = "vyre.assistant.look";

function emit(): void { for (const l of [...listeners]) l(); }

/** The open Space's assistant. Called by the shell as it opens a Space; renaming it ("Irfad's Assistant") changes nothing here. */
export function setAssistantId(id: string): void {
  if (state.id === id) return;
  let look = "";
  try { look = globalThis.localStorage?.getItem(`${KEY}:${id}`) ?? ""; } catch { /* no storage: the default mark */ }
  state = { id, look };
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

export const assistantId = (): string => state.id;
export const assistantLook = (): string => state.look;
export function subscribeAssistant(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
/** Test seam: forget the assistant and its look. */
export function resetAssistant(): void { state = { id: "", look: "" }; emit(); }

export const isAssistantId = (id: string | undefined): boolean => id !== undefined && id !== "" && id === state.id;

/** Anything that has a face: a person, an agent (the assistant is one) or another kind of thing. */
export interface AvatarEntity { id?: string | undefined; name: string; kind?: AvatarKind | "assistant"; photo?: string | undefined }

/** The props for <Avatar>: the assistant (by id or kind) gets kind "assistant" (the Vyre mark, or its chosen look); an agent is seeded by its id; a person by their id with their photo. */
export function avatarOf(e: AvatarEntity): Pick<AvatarProps, "name" | "seedId" | "kind" | "photo"> {
  const kind: AvatarKind = e.kind === "assistant" || (e.kind === "agent" && isAssistantId(e.id)) ? "assistant" : e.kind ?? "person";
  return { name: e.name, seedId: e.id, kind, ...(e.photo !== undefined ? { photo: e.photo } : {}) };
}
