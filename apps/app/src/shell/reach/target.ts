// Every click that opens something goes through one door, ShellRuntime.open, and that door asks reach (owner, 4 Nov: never send anyone to a place they cannot open). This file turns a target
// (a screen or a subject) into what reach judges: a Console page by the viewer's console.nav answer, an item by the read its destination makes (the same capability the title read uses). A read the
// server refuses with a permission or not-found error is "no access", so the click does nothing and says so; any other failure (a network blip) lets the click through, because the destination checks again.
import { PAGES } from "../../console/shell/nav.ts";
import { reach } from "./reach.ts";
import type { Policy } from "./policy.ts";
import type { Level, Reach, Viewer } from "./reach.ts";

export interface OpenTarget {
  screen?: string;
  subject?: { type: string; id: string };
  args?: Record<string, unknown>;
  background?: boolean;
}

/** The Console page a target names: its page argument when it is one of the Console's pages for that screen, else the first page that draws it. Null for a target that is not a Console page. */
export function consolePageOf(t: OpenTarget): string | null {
  if (t.screen === undefined) return null;
  const pages = PAGES.filter((p) => p.screen === t.screen);
  if (pages.length === 0) return null;
  const asked = typeof t.args?.["page"] === "string" ? t.args["page"] : undefined;
  return (pages.find((p) => p.id === asked) ?? pages[0]!).id;
}

/** The read each kind of item makes when it opens: the destination's own get. A kind not listed has no read, and the door lets it through. */
const READS: Readonly<Record<string, (id: string, args: Readonly<Record<string, unknown>>) => { cap: string; input: Record<string, unknown> } | null>> = {
  thread: (id) => ({ cap: "threads.get", input: { threadId: id } }),
  channel: (id) => ({ cap: "threads.get", input: { threadId: id } }),
  folder: (id) => ({ cap: "files.folder.get", input: { folderId: id } }),
  chat: (id) => ({ cap: "threads.get", input: { threadId: id } }),
  task: (id) => ({ cap: "tasks.get", input: { taskId: id } }),
  goal: (id) => ({ cap: "goals.get", input: { goalId: id } }),
  run: (id) => ({ cap: "runs.get", input: { runId: id } }),
  automation: (id) => ({ cap: "automations.get", input: { automationId: id } }),
  project: (id) => ({ cap: "projects.get", input: { projectId: id } }),
  agent: (id) => ({ cap: "agents.get", input: { agentId: id } }),
  file: (id) => ({ cap: "files.get", input: { fileId: id } }),
  doc: (id) => ({ cap: "files.get", input: { fileId: id } }),
  document: (id) => ({ cap: "files.get", input: { fileId: id } }),
  // a record is read by its type and id; a record opened without its type is left to the destination
  record: (id, args) => (typeof args["type"] === "string" && args["type"] !== "" ? { cap: "records.get", input: { type: args["type"], recordId: id } } : null),
  contact: (id, args) => (typeof args["type"] === "string" && args["type"] !== "" ? { cap: "records.get", input: { type: args["type"], recordId: id } } : null),
};

/** The read that tells whether the viewer may open this item. Null when the target is not an item (a screen of a place, the shell's own). */
export function readOf(t: OpenTarget): { cap: string; input: Record<string, unknown> } | null {
  if (t.subject) return READS[t.subject.type]?.(t.subject.id, t.args ?? {}) ?? null;
  const agent = typeof t.args?.["agentId"] === "string" && t.args["agentId"] !== "" ? t.args["agentId"] : null;
  if ((t.screen === "chats.agent-page" || t.screen === "chats.agent-form") && agent !== null) return READS["agent"]!(agent, {});
  const computer = t.screen === "chats.agent-computer" && typeof t.args?.["computerId"] === "string" ? t.args["computerId"] : null;
  if (computer !== null) return { cap: "computers.get", input: { computerId: computer } };
  const thread = (t.screen === "chats.conversation") && typeof t.args?.["threadId"] === "string" && t.args["threadId"] !== "" ? t.args["threadId"] : null;
  if (thread !== null) return READS["thread"]!(thread, {});
  return null;
}

/** Does the Space's answer say the viewer has no access (permission or not found), as opposed to the Space not answering? */
export function isDenial(e: unknown): boolean {
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  return code.startsWith("permission.") || code === "auth.forbidden" || code === "not_found" || code.endsWith(".not_found") || code.endsWith(".forbidden");
}

export interface Judge {
  viewer: () => Viewer;
  call(cap: string, input: unknown): Promise<unknown>;
  /** The Console page ids console.nav lists, read once. */
  consolePages(): Promise<ReadonlySet<string>>;
  /** The Space's link policy: what the links on screen already asked, so a click reads the same answer the link was drawn from. */
  links?: Policy;
  /** What was already read this session: an item the viewer opened once opens at once the next time. */
  memo?: Map<string, Level>;
}

/** Does this target need a read before it opens, or is its answer already known without one? A Console page needs the viewer's pages; an item needs its read. */
export const needsJudging = (t: OpenTarget): boolean => consolePageOf(t) !== null || readOf(t) !== null;

export async function judge(t: OpenTarget, j: Judge): Promise<Reach> {
  const page = consolePageOf(t);
  if (page !== null) {
    const consolePages = await j.consolePages().catch(() => new Set<string>());
    // a screen several pages draw opens when any of them is the viewer's
    const mine = PAGES.find((p) => p.screen === t.screen && consolePages.has(p.id));
    return reach({ kind: "console", page: mine?.id ?? page }, { ...j.viewer(), consolePages });
  }
  const read = readOf(t);
  if (read === null) return { to: "open", where: "", target: { place: "chats" } };
  // the answer the link was drawn from: a thing the policy learned about is not read a second time
  const sub0 = t.subject;
  if (sub0 && j.links) {
    const lv = j.links.levelOf(sub0);
    if (lv !== undefined) return reach({ kind: "item", type: sub0.type, id: sub0.id, title: "", level: lv }, j.viewer());
  }
  const key = `${read.cap}:${JSON.stringify(read.input)}`;
  const known = j.memo?.get(key);
  let level: Level = known ?? "view";
  if (known === undefined) {
    try { await j.call(read.cap, read.input); j.memo?.set(key, "view"); } catch (e) { if (isDenial(e)) { level = "none"; j.memo?.set(key, "none"); } }
  }
  const sub = t.subject ?? { type: "screen", id: t.screen ?? "" };
  return reach({ kind: "item", type: sub.type, id: sub.id, title: "", level }, j.viewer());
}

/** What a click that reach turned away says. */
export const NO_ACCESS = "You do not have access to that";
