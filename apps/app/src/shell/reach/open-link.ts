// /open/<kind>/<id> on the Space's web address, and vyre://open?address=&kind=&id= in the desktop app (the link l-share2's Copy link makes). It signs in if needed, then goes through reach: the
// deepest place the person can open, else the safe peek with Ask for access, never a dead end. This file is the pure part: reading the link, naming its target, and deciding.
import { hiddenTitle } from "../../../../../ui/src/blocks/link-card/state.ts";
import { isDenial, judge } from "./target.ts";
import type { Judge, OpenTarget } from "./target.ts";

export interface OpenItem { kind: string; id: string }

const KIND = /^[a-z_]{2,24}$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** The kind and id a path names, or null for any other address. */
export function parseOpenPath(pathname: string): OpenItem | null {
  const m = /^\/open\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  let kind: string, id: string;
  try { kind = decodeURIComponent(m[1]!); id = decodeURIComponent(m[2]!); } catch { return null; }
  return KIND.test(kind) && ID.test(id) ? { kind, id } : null;
}

/** What each kind in a link opens: the subject the shell resolves to a place, with the arguments that place needs. Null for a kind with no page of its own. */
export function targetOfOpen(item: OpenItem): OpenTarget | null {
  const { kind, id } = item;
  switch (kind) {
    case "file": case "folder": case "task": case "project": case "agent": case "automation": case "run": case "goal": case "channel": case "computer": return { subject: { type: kind === "computer" ? "agent" : kind, id } };
    case "thread": case "chat": return { subject: { type: "thread", id } };
    case "record": return { subject: { type: "record", id } };
    case "record_type": return { screen: "records.types", args: { type: id } };
    case "note": return { screen: "chats.notes", args: { noteId: id } };
    case "vault": return { screen: "vault.layout", args: { share: id } };
    default: return null;
  }
}

export type OpenDecision =
  | { to: "open"; target: OpenTarget }
  | { to: "peek"; text: string; ask: { type: string; id: string } | null };

/** The resource type access.request names for a kind. */
const ASK_TYPE: Readonly<Record<string, string>> = { chat: "thread", thread: "thread", record_type: "record_type", vault: "vault_item", computer: "computer" };

/** The access resource type of the kinds judged by access.reach alone (no read of their own that is cheap to make). */
const PRECHECK: Readonly<Record<string, string>> = { record: "record", record_type: "record_type", vault: "vault_item" };

async function levelOf(j: Judge, type: string, id: string): Promise<string> {
  try {
    const out = (await j.call("access.reach", { items: [{ type, id }] })) as { items?: Array<{ level: string }> };
    return out.items?.[0]?.level ?? "view";
  } catch { return "view"; }
}

/** Where the link goes for this person: the target when they can open it, else a peek that says only what kind of thing it is. */
export async function decideOpen(item: OpenItem, j: Judge): Promise<OpenDecision> {
  const target = targetOfOpen(item);
  const ask = { type: ASK_TYPE[item.kind] ?? item.kind, id: item.id };
  if (target === null) return { to: "peek", text: "That link does not open anything here", ask: null };
  const r = await judge(target, j);
  if (r.to === "open" && item.kind === "note") {
    try { await j.call("memory.read_note", { noteId: item.id }); } catch (e) { if (isDenial(e)) return { to: "peek", text: hiddenTitle("note"), ask: null }; }
  }
  if (r.to === "open" && PRECHECK[item.kind] !== undefined) {
    // kinds whose page answers for itself with a refusal: ask the Space's access first, so no link lands on that refusal
    const rt = PRECHECK[item.kind]!;
    const level = await levelOf(j, rt, item.id);
    if (level === "none") return { to: "peek", text: hiddenTitle(item.kind === "vault" || item.kind === "record_type" ? undefined : item.kind), ask };
  }
  if (r.to === "open") return { to: "open", target };
  return { to: "peek", text: `${hiddenTitle(item.kind === "vault" ? undefined : item.kind)}`, ask };
}

// The link waits here from the moment it is read (the address, or the desktop's deep link) until a Space is open to act on it, so a sign-in in between does not lose it.
let pending: OpenItem | null = null;
const listeners = new Set<() => void>();
export const holdOpen = (item: OpenItem): void => { pending = item; for (const l of [...listeners]) l(); };
export const takeOpen = (): OpenItem | null => { const p = pending; pending = null; return p; };
export const peekOpen = (): OpenItem | null => pending;
export const onOpenHeld = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
