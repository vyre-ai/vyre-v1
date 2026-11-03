// Watching (Vyre for Chrome): a page, or a region of one, checked on a rhythm. Where it runs is a choice made on the Watch sheet: in the person's Chrome (the extension reads the page and reports)
// or on an agent's computer (this module wakes the agent on the rhythm; the agent reads the page with its browsing tools and reports). Both come back through automations.watches.report.
// DECISION: a watch belongs to the person who made it; nobody else reads it. An agent that reports acts for that person (actingFor), never for itself.
// DECISION: the first reading is the baseline, never a change. A change is a different reading after whitespace is collapsed; the alert keeps what it was and what it is now.
// DECISION: the alert goes to a chat (one per watch, made on the first change) with the person and whoever they asked to tell; the words hold both readings, so a client with no card for it still shows them.
import { clean, newId, raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";

type Obj = Record<string, unknown>;
type Row = Record<string, unknown>;

export const WATCH_TABLE = "automations_watches";
/** The longest reading kept. A page's text is cut here; a change after the cut is not seen. */
export const READING_MAX = 20_000;
/** Words from a reading in an alert. */
const QUOTE_MAX = 700;
/** Failed reads in a row before the watch says it needs attention. */
const ERRORS_BEFORE_STATE = 3;

export interface WatchOut {
  watchId: string; title: string; url: string; host: string; mode: "region" | "page"; region?: { label: string; selector?: string };
  everyMinutes: number; tell: string[]; tellThreads: string[]; goalId?: string; agentId?: string; runsOn: "computer" | "chrome"; computerId?: string; state: "on" | "paused" | "error";
  checkNow: boolean; value?: string; lastCheckedAt?: number; nextDueAt?: number; changes: number; lastChange?: { at: number; before: string; after: string };
  threadId?: string; error?: string; createdAt: number; updatedAt: number;
}

const s = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v === "") return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

/** What the person reads on the page, with runs of white space made one space. Two readings that differ only in layout are the same reading. */
export const normalize = (v: string): string => v.replace(/\s+/g, " ").trim();
const quote = (v: string): string => (v.length > QUOTE_MAX ? `${v.slice(0, QUOTE_MAX).trimEnd()}...` : v) || "(nothing)";

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function checkUrl(ctx: AutoCtx, url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return raise(ctx, "validation.bad_input", "That is not a web address."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") raise(ctx, "validation.bad_input", "A watch needs a web page (http or https).");
  return u.toString();
}

function personOf(ctx: AutoCtx): string {
  const p = ctx.principal.kind === "person" ? ctx.principal.id : ctx.principal.kind === "agent" && typeof ctx.actingFor === "string" && ctx.actingFor.startsWith("usr_") ? ctx.actingFor : undefined;
  if (!p) raise(ctx, "permission.no_grant", "Watches belong to a person.");
  return p;
}

export function watchOut(r: Row): WatchOut {
  const region = json<{ label?: string; selector?: string } | null>(r["region_json"], null);
  const value = s(r["value"]);
  const was = r["was"], now = r["now_text"], at = n(r["changed_at"]);
  return clean({
    watchId: String(r["id"]), title: String(r["title"]), url: String(r["url"]), host: String(r["host"]), mode: r["mode"] === "page" ? "page" : "region",
    region: region ? clean({ label: String(region.label ?? ""), selector: s(region.selector) }) : undefined,
    everyMinutes: Number(r["every_min"]), tell: json<string[]>(r["tell_json"], []), tellThreads: json<string[]>(r["tell_threads_json"], []), goalId: s(r["goal_id"]), agentId: s(r["agent_id"]), runsOn: r["runs_on"] === "chrome" ? "chrome" : "computer", computerId: s(r["computer_id"]),
    state: r["state"] === "paused" ? "paused" : r["state"] === "error" ? "error" : "on", checkNow: Number(r["check_now"]) === 1,
    value: value === undefined ? undefined : value.slice(0, 2000), lastCheckedAt: n(r["last_checked_at"]), nextDueAt: n(r["next_due_at"]), changes: Number(r["changes"]),
    lastChange: at !== undefined && typeof was === "string" && typeof now === "string" ? { at, before: was.slice(0, 2000), after: now.slice(0, 2000) } : undefined,
    threadId: s(r["thread_id"]), error: s(r["error"]), createdAt: Number(r["created_at"]), updatedAt: Number(r["updated_at"]),
  }) as WatchOut;
}

function rowOf(ctx: AutoCtx, id: string): Row | undefined {
  return (ctx.db.all(`SELECT * FROM ${WATCH_TABLE} WHERE id = ? AND deleted_at IS NULL`, id) as Row[])[0];
}
/** The person's own watch, or "there is no such watch" for anyone else's. */
function mine(ctx: AutoCtx, id: string, person: string): Row {
  const r = rowOf(ctx, id);
  if (!r || r["owner"] !== person) return raise(ctx, "validation.not_found", "There is no such watch.");
  return r;
}

function put(ctx: AutoCtx, r: Row): void {
  const cols = Object.keys(r);
  ctx.db.run(`INSERT OR REPLACE INTO ${WATCH_TABLE} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => r[c] ?? null));
}

type Region = { label: string; selector?: string };
type SaveIn = {
  watchId?: string; title: string; url: string; mode: "region" | "page"; region?: Region; everyMinutes: number; tell?: string[]; tellThreads?: string[]; goalId?: string | null; agentId?: string; runsOn: "computer" | "chrome"; computerId?: string;
  paused?: boolean; value?: string; idempotencyKey: string;
};
export async function save(ctx: AutoCtx, input: SaveIn): Promise<{ watch: WatchOut }> {
  const person = personOf(ctx);
  const now = ctx.now();
  const url = checkUrl(ctx, input.url);
  if (input.mode === "region" && !input.region) raise(ctx, "validation.bad_input", "A region watch needs the region to read.");
  if (input.runsOn === "computer" && !input.agentId) raise(ctx, "validation.bad_input", "A watch that runs on an agent's computer needs the agent.");
  const tell = [...new Set((input.tell ?? []).filter((p) => p !== person))].slice(0, 20);
  const baseline = input.value === undefined ? undefined : normalize(input.value).slice(0, READING_MAX);
  const prior = input.watchId ? mine(ctx, input.watchId, person) : (ctx.db.all(`SELECT * FROM ${WATCH_TABLE} WHERE owner = ? AND idem_key = ? AND deleted_at IS NULL`, person, input.idempotencyKey) as Row[])[0];
  const r: Row = prior ? { ...prior } : {
    id: newId("wch", now), owner: person, state: "on", check_now: 0, changes: 0, errors_in_row: 0, value: baseline ?? null, last_checked_at: baseline === undefined ? null : now, created_at: now, idem_key: input.idempotencyKey,
  };
  Object.assign(r, {
    title: input.title.trim().slice(0, 200) || hostOf(url), url, host: hostOf(url), mode: input.mode, region_json: input.mode === "region" && input.region ? JSON.stringify(clean(input.region)) : null,
    every_min: input.everyMinutes, tell_json: JSON.stringify(tell), tell_threads_json: JSON.stringify([...new Set(input.tellThreads ?? [])].slice(0, 20)), agent_id: input.agentId ?? null, runs_on: input.runsOn, computer_id: input.computerId ?? null, updated_at: now,
  });
  // changing what is read starts a new baseline: the old reading is of something else
  if (prior && (prior["url"] !== url || prior["region_json"] !== r["region_json"] || prior["mode"] !== input.mode)) Object.assign(r, { value: baseline ?? null, last_checked_at: baseline === undefined ? null : now, error: null, errors_in_row: 0 });
  if (input.paused !== undefined) r["state"] = input.paused ? "paused" : "on";
  if (!prior || prior["every_min"] !== input.everyMinutes || r["state"] === "on") r["next_due_at"] = now + (baseline === undefined ? 0 : input.everyMinutes * 60_000);
  if (input.goalId !== undefined) await linkGoal(ctx, r, input.goalId);
  // the chat is made now, by the person: an agent woken in it acts for them, which is what lets it report what it read
  if (!r["thread_id"] && r["agent_id"]) await alertThread(ctx, r);
  put(ctx, r);
  ctx.emit("automation.watch_saved", String(r["id"]), { watchId: String(r["id"]), owner: person, op: prior ? "changed" : "added" }, { vis: "owner" });
  return { watch: watchOut(r) };
}

/**
 * "Counts toward a goal": the goal's finish line reads this watch. goals.get and goals.update run as the person, so only a goal they may see and control can be linked; a goal whose
 * finish line is not a number cannot. null takes the watch off the goal.
 */
async function linkGoal(ctx: AutoCtx, r: Row, goalId: string | null): Promise<void> {
  const was = s(r["goal_id"]);
  if (goalId === null) { r["goal_id"] = null; return; }
  if (was === goalId) return;
  if (!ctx.call) raise(ctx, "validation.bad_input", "Goals cannot be reached from here.");
  let got: { goal?: { finish?: Record<string, unknown> } } | undefined;
  try { got = (await ctx.call("goals.get", { goalId })) as typeof got; } catch { raise(ctx, "validation.not_found", "There is no such goal, or it is not yours to change."); }
  const finish = got?.goal?.finish;
  if (!finish || finish["kind"] !== "number") raise(ctx, "validation.bad_input", "A watch can count toward a goal that has a number to reach.");
  try {
    await ctx.call("goals.update", { goalId, finish: { ...finish, source: { kind: "watch", watchId: String(r["id"]), label: `${String(r["title"])} (watched page)` } } });
  } catch { raise(ctx, "permission.no_grant", "Only the owner of a goal changes where its number comes from."); }
  r["goal_id"] = goalId;
}

export async function list(ctx: AutoCtx, input: { watchId?: string; runsOn?: "computer" | "chrome"; person?: string }): Promise<{ watches: WatchOut[] }> {
  // a goal reads its owner's watch for its progress: only a call another capability made (depth above zero) may name the person, never the gateway
  const person = input.person !== undefined && (ctx.depth ?? 0) > 0 ? input.person : personOf(ctx);
  const rows = (ctx.db.all(`SELECT * FROM ${WATCH_TABLE} WHERE owner = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`, person) as Row[])
    .filter((r) => (input.watchId === undefined || r["id"] === input.watchId) && (input.runsOn === undefined || r["runs_on"] === input.runsOn));
  return { watches: rows.map(watchOut) };
}

export async function remove(ctx: AutoCtx, input: { watchId: string; op: "remove" | "pause" | "resume" }): Promise<{ removed: boolean; watch?: WatchOut }> {
  const person = personOf(ctx);
  const r = mine(ctx, input.watchId, person);
  const now = ctx.now();
  r["updated_at"] = now;
  if (input.op === "remove") r["deleted_at"] = now;
  else if (input.op === "pause") r["state"] = "paused";
  else { r["state"] = "on"; r["next_due_at"] = now; r["error"] = null; r["errors_in_row"] = 0; }
  put(ctx, r);
  ctx.emit("automation.watch_saved", input.watchId, { watchId: input.watchId, owner: person, op: input.op === "remove" ? "removed" : input.op === "pause" ? "paused" : "resumed" }, { vis: "owner" });
  return input.op === "remove" ? { removed: true } : { removed: false, watch: watchOut(r) };
}

/** The words an agent is woken with for a watch that runs on its computer. */
export function wakeWords(w: WatchOut): string {
  const what = w.mode === "region" ? `the part called "${w.region?.label ?? "the region"}"${w.region?.selector ? ` (${w.region.selector})` : ""}` : "the whole page";
  return `Time to check a watch: ${w.title}.\nOpen ${w.url} on your computer and read ${what}. Then call automations_watches_report with watchId ${w.watchId} and the text you read. `
    + "If the page will not load or what you were asked to read is gone, report that in error instead. Do not tell the person anything yourself: Vyre tells them if it changed.";
}

async function tryCall<T = Obj>(ctx: AutoCtx, cap: string, input: unknown): Promise<T | undefined> {
  if (!ctx.call) return undefined;
  try { return (await ctx.call(cap, input)) as T; } catch { return undefined; }
}

/** The chat the alerts go to: one per watch, with the agent that checks it, the person and whoever they asked to tell. */
async function alertThread(ctx: AutoCtx, r: Row): Promise<string | undefined> {
  const have = s(r["thread_id"]);
  if (have) return have;
  const agent = s(r["agent_id"]);
  if (!agent) return undefined;
  const made = await tryCall<{ thread?: { threadId?: string } }>(ctx, "chat.start", { kind: "chat", agentIds: [agent], scopeType: "watch", scopeId: String(r["id"]), title: `Watching: ${String(r["title"])}`, idempotencyKey: `watch-thread:${String(r["id"])}` });
  const id = made?.thread?.threadId;
  if (!id) return undefined;
  for (const p of json<string[]>(r["tell_json"], [])) await tryCall(ctx, "threads.members.add", { threadId: id, personId: p });
  r["thread_id"] = id;
  return id;
}

export function changeWords(w: Pick<WatchOut, "title" | "url" | "mode" | "region">, before: string, after: string): string {
  const where = w.mode === "region" && w.region?.label ? ` (${w.region.label})` : "";
  return `${w.title} changed${where}.\n\nBefore: ${quote(before)}\nNow: ${quote(after)}\n\n${w.url}`;
}

type ReportIn = { watchId: string; value?: string; error?: string };
export async function report(ctx: AutoCtx, input: ReportIn): Promise<{ changed: boolean; watch: WatchOut }> {
  const person = personOf(ctx);
  const r = mine(ctx, input.watchId, person);
  const now = ctx.now();
  const every = Number(r["every_min"]) * 60_000;
  r["last_checked_at"] = now;
  r["check_now"] = 0;
  r["updated_at"] = now;
  r["next_due_at"] = now + every;
  let changed = false;
  if (input.value === undefined) {
    const inRow = Number(r["errors_in_row"]) + 1;
    r["errors_in_row"] = inRow;
    r["error"] = (input.error ?? "The page could not be read.").slice(0, 300);
    if (inRow >= ERRORS_BEFORE_STATE) r["state"] = "error";
  } else {
    const next = normalize(input.value).slice(0, READING_MAX);
    const prev = typeof r["value"] === "string" ? String(r["value"]) : undefined;
    r["errors_in_row"] = 0;
    r["error"] = null;
    if (r["state"] === "error") r["state"] = "on";
    if (prev !== undefined && prev !== next) {
      changed = true;
      Object.assign(r, { changes: Number(r["changes"]) + 1, changed_at: now, was: prev, now_text: next });
    }
    r["value"] = next;
  }
  if (changed) {
    const w = watchOut(r);
    const thread = await alertThread(ctx, r);
    const body = changeWords(w, String(r["was"]), String(r["now_text"]));
    if (thread) await tryCall(ctx, "chat.post", { threadId: thread, body, idempotencyKey: `watch-change:${w.watchId}:${w.changes}` });
    for (const th of w.tellThreads) if (th !== thread) await tryCall(ctx, "chat.post", { threadId: th, body, idempotencyKey: `watch-change:${w.watchId}:${w.changes}:${th}` });
  }
  put(ctx, r);
  if (changed) ctx.emit("automation.watch_changed", input.watchId, { watchId: input.watchId, owner: person, changes: Number(r["changes"]) }, { vis: "owner" });
  return { changed, watch: watchOut(r) };
}

/** Check now: a watch in this Chrome is read at the extension's next look (a minute at most); an agent's is woken at once. */
export async function check(ctx: AutoCtx, input: { watchId: string }): Promise<{ watch: WatchOut }> {
  const person = personOf(ctx);
  const r = mine(ctx, input.watchId, person);
  if (r["state"] === "paused") raise(ctx, "validation.precondition_failed", "This watch is paused.");
  const now = ctx.now();
  r["updated_at"] = now;
  if (r["runs_on"] === "chrome") { r["check_now"] = 1; put(ctx, r); return { watch: watchOut(r) }; }
  await wake(ctx, r, `watch-check:${String(r["id"])}:${now}`);
  r["next_due_at"] = now + Number(r["every_min"]) * 60_000;
  put(ctx, r);
  return { watch: watchOut(r) };
}

async function wake(ctx: AutoCtx, r: Row, key: string): Promise<void> {
  const thread = await alertThread(ctx, r);
  if (!thread) return;
  await tryCall(ctx, "chat.post", { threadId: thread, body: wakeWords(watchOut(r)), idempotencyKey: key });
}

/** Every minute: watches that run on an agent's computer and are due wake their agent. Chrome watches are the extension's to read. */
export async function tick(ctx: AutoCtx): Promise<string[]> {
  const now = ctx.now();
  const due = (ctx.db.all(`SELECT * FROM ${WATCH_TABLE} WHERE deleted_at IS NULL AND state = 'on' AND runs_on = 'computer' AND next_due_at IS NOT NULL AND next_due_at <= ? LIMIT 50`, now) as Row[]);
  const done: string[] = [];
  for (const r of due) {
    // move the next look first: a wake that fails is tried again at the next rhythm, not every minute
    r["next_due_at"] = now + Number(r["every_min"]) * 60_000;
    await wake(ctx, r, `watch-wake:${String(r["id"])}:${now}`);
    put(ctx, r);
    done.push(String(r["id"]));
  }
  return done;
}
