// The crew's lifecycle (DESIGN-crew.md, step 2): what a teammate's turns do to its job, and the one result card that reaches the lead's chat when a teammate finishes. The bridge reports every turn start, end and
// the moment the reply is posted (StreamEvent); this reads those for the threads that are crew jobs and nothing else. A finished teammate has its leftovers committed, its branch summarised, and posts one
// message in the lead's chat, as itself and mentioning the lead, with a `crew_result` block. That message is the wake: the lead's turn starts from it the ordinary way, so nobody polls and nothing new is routed.
import type { Db } from "./projections.ts";
import type { EngineHostSeam } from "../../host/src/seams/engine.ts";
import { commitLeftovers, summarize } from "./crew-git.ts";
import type { CrewSummary } from "./crew-git.ts";
import type { StreamEvent } from "./handlers/bridge.ts";
import { ensure } from "./projections.ts";
import { workFolder } from "./sandbox.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** The reply text a card quotes: the last thing the teammate said, short. */
export function cardBody(o: { name: string; title: string; state: "done" | "failed"; branch: string; summary?: CrewSummary; text?: string }): string {
  if (o.state === "failed") return `${o.name} could not finish "${o.title}".${o.text ? `\n\n${cut(o.text, 600)}` : ""}`;
  const s = o.summary;
  const work = s && (s.ahead > 0 || s.files.length > 0) ? `${s.ahead} commit${s.ahead === 1 ? "" : "s"}, ${s.files.length} file${s.files.length === 1 ? "" : "s"} on ${o.branch}.` : `no changes on ${o.branch}.`;
  return `${o.name} finished "${o.title}": ${work}${o.text ? `\n\n${cut(o.text, 1500)}` : ""}`;
}

export function createCrewWatcher(o: { db: Db; host: EngineHostSeam; now: () => number }): (e: StreamEvent) => void {
  const ended = new Map<string, "done" | "failed" | "cancelled" | "waiting">();
  const askers = new Map<string, string>();   // threadId -> the person whose turn ran there, for a helper's result
  const warn = (msg: string, attrs: Record<string, unknown>): void => o.host.log?.(msg, attrs);

  /** A helper thread (not a crew job) finished a turn: its answer is posted in the chat that started it, as the helper and naming the lead, so the lead wakes on it the way it does on a crew card. */
  async function helperResult(e: Extract<StreamEvent, { kind: "final" }>): Promise<void> {
    const asker = askers.get(e.threadId);
    const state = ended.get(e.turnId) ?? "done";
    ended.delete(e.turnId);
    if (!asker || state === "waiting" || state === "cancelled") return;
    const th = ((await o.host.call("threads.get", { threadId: e.threadId }, asker)) as { thread?: { kind?: string; title?: string; parentThreadId?: string } }).thread;
    if (th?.kind !== "helper" || !th.parentThreadId) return;
    let text = "";
    if (e.messageId) { try { text = str(((await o.host.call("chat.message.get", { threadId: e.threadId, messageId: e.messageId }, asker)) as { message?: { body?: string } }).message?.body).trim(); } catch { /* the line goes without the words */ } }
    let name = e.agentId;
    try { name = str(((await o.host.call("agents.get", { agentId: e.agentId }, asker)) as { agent?: { name?: string } }).agent?.name) || name; } catch { /* the id stands */ }
    let lead: string | undefined;
    try { lead = ((await o.host.call("threads.get", { threadId: th.parentThreadId }, asker)) as { thread?: { agents?: Array<{ agentId: string; mode: string }> } }).thread?.agents?.find((a) => a.mode === "lead")?.agentId; } catch { /* nobody to wake */ }
    const title = str(th.title);
    const body = state === "failed" ? `Helper "${title}" could not finish.${text ? `\n\n${cut(text, 600)}` : ""}` : `Helper "${title}" found:\n\n${text ? cut(text, 1500) : "(it ended with no words)"}`;
    // the lead often is the helper's own agent: an agent's own post never wakes itself, so the line goes in as the person it works for, as a wait does (crew-waits.ts), with a block that shows it as a card line
    await o.host.call("chat.post", {
      threadId: th.parentThreadId, body, mentions: lead ? [{ kind: "agent", id: lead }] : [],
      blocks: [{ type: "crew_wait", v: 1, data: { waitId: `hlp${e.turnId.replace(/^trn_/, "")}`.slice(0, 40), label: `Helper "${title}"`, outcome: state === "failed" ? "failing" : "passing", done: 1, total: 1 } }],
      idempotencyKey: `helper-result-${e.turnId}`,
    }, asker);
  }

  async function finish(job: Row, turnId: string, state: "done" | "failed", messageId: string | null): Promise<void> {
    const asker = str(job["asker"]);
    const thread = str(job["thread_id"]);
    let summary: CrewSummary | undefined;
    const dataDir = o.host.dataDir;
    if (dataDir && state === "done") {
      const dir = workFolder(dataDir, asker, thread);
      try { await commitLeftovers(dir, `Work in progress by ${str(job["agent_id"])}`); summary = await summarize(dir, str(job["base_branch"])); } catch (e) { warn("the teammate's branch could not be summarised", { jobId: str(job["job_id"]), error: e instanceof Error ? e.message : String(e) }); }
    }
    let text = "";
    if (messageId) { try { text = str(((await o.host.call("chat.message.get", { threadId: thread, messageId }, asker)) as { message?: { body?: string } }).message?.body).trim(); } catch { /* the card goes without the words */ } }
    let name = str(job["agent_id"]);
    try { name = str(((await o.host.call("agents.get", { agentId: str(job["agent_id"]) }, asker)) as { agent?: { name?: string } }).agent?.name) || name; } catch { /* the id stands */ }
    const result = { text, ...(summary ? { summary } : {}) };
    o.db.run("UPDATE engine_crew_job SET state = ?, ended_at = ?, result_json = ? WHERE job_id = ? AND state != 'merged'", state, o.now(), JSON.stringify(result), str(job["job_id"]));
    let lead: string | undefined;
    try { lead = ((await o.host.call("threads.get", { threadId: str(job["lead_thread_id"]) }, asker)) as { thread?: { agents?: Array<{ agentId: string; mode: string }> } }).thread?.agents?.find((a) => a.mode === "lead")?.agentId; } catch { /* no one to wake */ }
    const data = {
      jobId: str(job["job_id"]), threadId: thread, agentId: str(job["agent_id"]), name, title: str(job["title"]), branch: str(job["branch"]), base: str(job["base_branch"]), state,
      ...(summary ? { commits: summary.commits, files: summary.files, ahead: summary.ahead } : {}), ...(text ? { text: cut(text, 4000) } : {}),
    };
    await o.host.postAs(str(job["agent_id"]), {
      actingFor: asker, threadId: str(job["lead_thread_id"]), body: cardBody({ name, title: str(job["title"]), state, branch: str(job["branch"]), ...(summary ? { summary } : {}), text }),
      blocks: [{ type: "crew_result", v: 1, data }], mentions: lead ? [{ kind: "agent", id: lead }] : [], clientId: `msg_crw${str(job["job_id"]).replace(/^crw_/, "")}${turnId.replace(/^trn_/, "")}`.replace(/[^a-z0-9_]/g, ""),
    });
  }

  async function handle(e: StreamEvent): Promise<void> {
    ensure(o.db);
    if (e.kind === "start") askers.set(e.threadId, e.asker);
    if (e.kind === "end") ended.set(e.turnId, e.state);
    const job = o.db.all("SELECT * FROM engine_crew_job WHERE thread_id = ?", e.threadId)[0] as Row | undefined;
    if (!job) { if (e.kind === "final") await helperResult(e); else if (e.kind === "end" && e.state === "done") { /* kept for the final that follows */ } return; }
    if (e.kind === "start") { o.db.run("UPDATE engine_crew_job SET state = 'working', ended_at = NULL WHERE job_id = ? AND state IN ('done', 'failed', 'stopped', 'waiting')", str(job["job_id"])); return; }
    if (e.kind === "end") {
      ended.set(e.turnId, e.state);
      if (e.state === "waiting") o.db.run("UPDATE engine_crew_job SET state = 'waiting' WHERE job_id = ? AND state = 'working'", str(job["job_id"]));
      return;
    }
    if (e.kind !== "final") return;
    const state = ended.get(e.turnId) ?? "done";
    ended.delete(e.turnId);
    if (state === "waiting") return;
    if (state === "cancelled") { o.db.run("UPDATE engine_crew_job SET state = 'stopped', ended_at = ? WHERE job_id = ? AND state IN ('working', 'waiting')", o.now(), str(job["job_id"])); return; }
    await finish(job, e.turnId, state, e.messageId);
  }

  return (e) => { void handle(e).catch((err) => warn("a crew teammate's turn could not be followed", { threadId: e.threadId, error: err instanceof Error ? err.message : String(err) })); };
}
