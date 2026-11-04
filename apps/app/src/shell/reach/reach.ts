// reach(item, viewer): where a link, chip, row, menu item or search result goes for this person (owner, 4 Nov: never send anyone to a place they cannot open).
// It returns the deepest place the viewer can open; failing that a peek (a read-only card in a popover or the right pane); failing that nothing, and the label shows as plain text.
// Hover and click both read the one answer (hint, act), so a hover never says something a click does not do. The Console's own answer (console.nav, as the viewer's page ids) and the
// person's permission keys are the access checks; an item carries the facts its destination checks (level, members, owner, private).
import { PAGES } from "../../console/shell/nav.ts";
import type { PlaceId } from "../rail/kits.ts";

export interface Viewer {
  id: string;
  /** The Space the viewer is in; "Tell an admin" files its request here. */
  spaceId?: string;
  /** The permission keys the viewer's roles carry. Absent: unknown, so a page is judged by consolePages alone. */
  perms?: ReadonlySet<string>;
  /** The Console page ids console.nav lists for the viewer (the Console's own check). Absent or empty: the viewer has no Console. */
  consolePages?: ReadonlySet<string>;
  /** Places the viewer's rail shows. Absent: unknown, so none is ruled out. */
  places?: ReadonlySet<PlaceId>;
}

export type Level = "none" | "view" | "use" | "edit" | "manage";

export interface Target { place: PlaceId; hash?: string; screen?: string; args?: Record<string, string> }

export type Item =
  | { kind: "console"; page: string; args?: Record<string, string> }
  | {
      kind: "machine"; id: string; name: string; online: boolean; machineKind: "space" | "server" | "linked"; owner?: string; ownerName?: string;
      /** Names of the agents that run there. */
      agents: readonly string[];
      /** What needs an admin ("Offline", "Disk almost full"), when something does. */
      needs?: string;
    }
  | { kind: "item"; type: "record" | "file" | "folder" | "chat" | "task" | "run" | "computer" | "vault" | "agent" | "project"; id: string; title: string; place?: PlaceId; hash?: string;
      /** The viewer's level on it, when the caller read it from the same grant the destination checks. */
      level?: Level; private?: boolean; members?: readonly string[]; owner?: string;
      /** A line a peek may show when the viewer cannot open it but may know it exists (a task someone else holds shows its title). Absent: no peek. */
      summary?: string }
  | { kind: "place"; place: PlaceId; hash?: string };

export interface Peek {
  title: string;
  lines: readonly string[];
  /** The one action: "Tell an admin", offered when the thing needs an admin and the viewer is not one. */
  tell?: { label: string; reason: string };
}

export type Reach =
  | { to: "open"; target: Target; where: string }
  | { to: "peek"; peek: Peek }
  | { to: "none" };

const NONE: Reach = { to: "none" };

/** Can this viewer open the Console page: console.nav lists it. The Console draws the same check, so a link and the page never disagree. */
export function canOpenPage(viewer: Viewer, page: string): boolean {
  return viewer.consolePages?.has(page) === true;
}

/** The viewer is an admin of the Space: the Console lists its Machines page for them. */
export const isAdmin = (viewer: Viewer): boolean => canOpenPage(viewer, "machines");

function openItem(item: Extract<Item, { kind: "item" }>, viewer: Viewer): boolean {
  if (item.level !== undefined) return item.level !== "none";
  if (item.owner === viewer.id) return true;
  if (item.members !== undefined) return item.members.includes(viewer.id);
  return item.private !== true;
}

const PLACE_OF_TYPE: Readonly<Record<string, PlaceId>> = { record: "records", project: "records", file: "files", folder: "files", chat: "chats", task: "chats", run: "automations", computer: "chats", vault: "vault", agent: "chats" };

function machine(m: Extract<Item, { kind: "machine" }>, viewer: Viewer): Reach {
  if (isAdmin(viewer)) {
    const page = PAGES.find((p) => p.id === "machines");
    return { to: "open", where: "Console › Computers", target: { place: "console", screen: page?.screen ?? "console.machines", args: { page: "machines", machineId: m.id } } };
  }
  if (m.owner !== undefined && m.owner === viewer.id) return { to: "open", where: "Settings › This device", target: { place: "settings", screen: "settings.page", args: { page: "computer" } } };
  const whose = m.machineKind === "space" || m.owner === undefined ? "Shared server" : `${m.ownerName ?? "Someone"}'s computer`;
  const lines = [m.online ? "Online" : "Offline", m.agents.length === 0 ? "No agents run here" : `Runs ${m.agents.join(", ")}`, whose];
  return { to: "peek", peek: { title: m.name, lines, ...(m.needs !== undefined ? { tell: { label: "Tell an admin", reason: `${m.name}: ${m.needs}` } } : {}) } };
}

export function reach(item: Item, viewer: Viewer): Reach {
  switch (item.kind) {
    case "console": {
      const page = PAGES.find((p) => p.id === item.page);
      if (page === undefined || !canOpenPage(viewer, item.page)) return NONE;
      return { to: "open", where: `Console › ${page.title}`, target: { place: "console", screen: page.screen, args: { page: page.id, ...(item.args ?? {}) } } };
    }
    case "machine": return machine(item, viewer);
    case "place": {
      if (viewer.places !== undefined && !viewer.places.has(item.place)) return NONE;
      return { to: "open", where: item.place, target: { place: item.place, ...(item.hash !== undefined ? { hash: item.hash } : {}) } };
    }
    case "item": {
      const place = item.place ?? PLACE_OF_TYPE[item.type] ?? "chats";
      if (viewer.places !== undefined && !viewer.places.has(place)) return NONE;
      if (openItem(item, viewer)) return { to: "open", where: item.title, target: { place, hash: item.hash ?? `subject=${item.type === "computer" ? "agent" : item.type}:${item.id}` } };
      return item.summary !== undefined ? { to: "peek", peek: { title: item.title, lines: [item.summary] } } : NONE;
    }
  }
}

/** What a hover says. It is read from the same answer a click acts on. Null: no hover (a plain label). */
export function hint(r: Reach): string | null {
  if (r.to === "open") return `Opens ${r.where}`;
  if (r.to === "peek") return "Shows a summary";
  return null;
}

export interface Acts {
  open(target: Target): void;
  peek(peek: Peek): void;
}

/** What a click does. Returns what it did, so a test can compare it with the hover. */
export function act(r: Reach, acts: Acts): "open" | "peek" | null {
  if (r.to === "open") { acts.open(r.target); return "open"; }
  if (r.to === "peek") { acts.peek(r.peek); return "peek"; }
  return null;
}

/** Is the label a link at all? Only a label with somewhere to go is styled and pressable. */
export const isLink = (r: Reach): boolean => r.to !== "none";

/** A search result, kept only when the viewer can open it (a page) or it is a thing the server already answered for them. Console pages and places the rail does not show are dropped. */
export function listable(hit: { kind: string; place?: PlaceId; consolePage?: string }, viewer: Viewer): boolean {
  if (hit.consolePage !== undefined) return reach({ kind: "console", page: hit.consolePage }, viewer).to === "open";
  if (hit.place !== undefined) return reach({ kind: "place", place: hit.place }, viewer).to === "open";
  return true;
}

/** The request "Tell an admin" files: the Space's admins get it as a Needs you card, and the viewer sees one quiet line. */
export const TELL_SENT = "Sent to the Space's admins";
export async function tellAdmins(call: (cap: string, input: unknown) => Promise<unknown>, viewer: Viewer, reason: string): Promise<string> {
  await call("access.request", { resource: { type: "space", id: viewer.spaceId ?? "" }, level: "view", note: reason, idempotencyKey: `tell:${viewer.id}:${reason}`.slice(0, 120) });
  return TELL_SENT;
}
