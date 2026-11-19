// The reads behind the run views, in one file (lane r42-subagents): what the runtime serves (manifests/runs.ts on wip/r42-runtime: runs.activity.list, runs.board.list, runs.message.list, runs.node.get) turned into the
// shapes run/model.ts draws. A server that does not have a read yet answers with an error; every function here then says "nothing", never throws at a screen. When the runtime renames a field, this is the one file to change.
import type { ActivityRow, BoardEntry, NodeMessage, RunNode } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const STATUS = new Set(["queued", "running", "waiting", "paused", "succeeded", "failed", "stopped"]);

/** The one current line of what a node is on: the runtime serves it as {icon, text}; a plain string is taken as it is. */
/** The kind of step, for the mark before its line. */
function stepIconOf(v: unknown): string | undefined {
  return v && typeof v === "object" ? str((v as Obj)["icon"]) : undefined;
}

function stepTextOf(v: unknown): string | undefined {
  return typeof v === "string" ? str(v) : v && typeof v === "object" ? str((v as Obj)["text"]) : undefined;
}

/** A node waiting for a person's yes: the request (the Gate task), what it is for, and why. Words only. */
function needOf(v: unknown): { requestId: string; what: string; why: string } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Obj;
  const requestId = str(o["requestId"]);
  const what = str(o["what"]);
  return requestId && what ? { requestId, what, why: str(o["why"]) ?? "" } : undefined;
}

/** runs.activity.list rows as the list draws them; a row with no id or an unknown status is dropped, a missing name reads "Helper" (an id is never shown). */
export function activityRowsOf(out: unknown): ActivityRow[] {
  const rows = (out as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r: Obj) => {
    if (r === null || typeof r !== "object") return [];
    const runId = str(r["runId"]);
    const status = str(r["status"]);
    if (runId === undefined || status === undefined || !STATUS.has(status)) return [];
    const wake = r["wake"] as Obj | undefined;
    const stuck = r["stuck"] as Obj | undefined;
    return [
      {
        runId,
        rootRun: str(r["rootRun"]) ?? runId,
        kind: str(r["kind"]) ?? "helper",
        name: str(r["name"]) ?? "Helper",
        status: status as ActivityRow["status"],
        ...(stepTextOf(r["step"]) !== undefined ? { step: stepTextOf(r["step"])! } : {}),
        ...(str(r["whoName"]) !== undefined ? { whoName: str(r["whoName"])! } : {}),
        ...(needOf(r["need"]) ? { need: needOf(r["need"])! } : {}),
        ...(wake
          ? {
              wake: {
                kind: str(wake["kind"]) ?? "event",
                ...(str(wake["label"]) !== undefined ? { label: str(wake["label"])! } : {}),
                ...(num(wake["dueAt"]) !== undefined ? { dueAt: num(wake["dueAt"])! } : {}),
                ...(num(wake["wokeCount"]) !== undefined ? { wokeCount: num(wake["wokeCount"])! } : {}),
              },
            }
          : {}),
        ...(stuck && str(stuck["reason"]) !== undefined
          ? { stuck: { since: num(stuck["since"]) ?? 0, reason: str(stuck["reason"])! } }
          : {}),
        startedAt: num(r["startedAt"]) ?? 0,
      },
    ];
  });
}

/** A server that does not have a read answers with an error that says so; any other error is a request that failed this once. */
export const isAbsent = (e: unknown): boolean =>
  /unknown (capability|cap)|no such (capability|cap)|unsupported capability|not implemented/i.test(
    String((e as { message?: unknown } | null)?.message ?? e),
  );

/** Everything of the Space that runs or sleeps: the rows, "absent" when this server has no such read, "failed" when this one request failed (the caller keeps what it had). */
export async function readActivity(call: Call): Promise<ActivityRow[] | "absent" | "failed"> {
  try {
    return activityRowsOf(await call("runs.activity.list", { scope: "mine", limit: 100 }));
  } catch (e) {
    return isAbsent(e) ? "absent" : "failed";
  }
}

/** The chat thread behind a run (a helper's own chat), if it has one: the session a press opens. */
export async function threadOfRun(call: Call, runId: string): Promise<string | null> {
  try {
    const node = (await call("runs.node.get", { runId })) as { node?: { threadId?: unknown } } | null;
    return str(node?.node?.threadId) ?? null;
  } catch {
    return null;
  }
}

/** runs.board.list entries as the board draws them. */
export function boardOf(out: unknown): BoardEntry[] {
  const e = (out as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(e)) return [];
  return e.flatMap((r: Obj) => {
    if (r === null || typeof r !== "object") return [];
    const id = str(r["id"]);
    const kind = str(r["kind"]);
    const text = str(r["text"]);
    const byRun = str(r["byRun"]);
    if (!id || !text || !byRun || (kind !== "fact" && kind !== "decision" && kind !== "question")) return [];
    if (str(r["supersededBy"]) !== undefined) return [];
    const a = r["answer"] as Obj | undefined;
    return [
      {
        id,
        kind,
        text,
        byRun,
        at: num(r["at"]) ?? 0,
        ...(Array.isArray(r["evidence"]) && r["evidence"].length > 0
          ? { evidence: (r["evidence"] as unknown[]).filter((x): x is string => typeof x === "string") }
          : {}),
        ...(a && str(a["text"]) !== undefined
          ? { answer: { byRun: str(a["byRun"]) ?? "", text: str(a["text"])!, at: num(a["at"]) ?? 0 } }
          : {}),
      },
    ];
  });
}

/** runs.message.list messages as the lines draw them. */
export function messagesOf(out: unknown): NodeMessage[] {
  const m = (out as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(m)) return [];
  return m.flatMap((r: Obj) => {
    if (r === null || typeof r !== "object") return [];
    const id = str(r["id"]);
    const fromRun = str(r["fromRun"]);
    const toRun = str(r["toRun"]);
    const body = str(r["body"]);
    if (!id || !fromRun || !toRun || !body) return [];
    return [
      {
        id,
        fromRun,
        toRun,
        body,
        at: num(r["at"]) ?? 0,
        ...(num(r["deliveredAt"]) !== undefined ? { deliveredAt: num(r["deliveredAt"])! } : {}),
        ...(num(r["seenAt"]) !== undefined ? { seenAt: num(r["seenAt"])! } : {}),
      },
    ];
  });
}

export async function readBoard(call: Call, runId: string): Promise<BoardEntry[] | null> {
  try {
    return boardOf(await call("runs.board.list", { runId }));
  } catch {
    return null;
  }
}

export async function readMessages(call: Call, runId: string): Promise<NodeMessage[] | null> {
  try {
    return messagesOf(await call("runs.message.list", { runId, tree: true }));
  } catch {
    return null;
  }
}

/**
 * The newest tree of work that ran in a thread (a chat, or a helper's own chat), and whether this person may read its board and messages (`full`: false means they only watch). "none": no tree there, or this server has no
 * such read; "failed": this one request failed, so the caller keeps what it showed.
 */
export async function findRoot(
  call: Call,
  threadId: string,
): Promise<{ rootRun: string; runId: string; full: boolean } | "none" | "failed"> {
  try {
    const out = (await call("runs.tree.find", { threadId, limit: 1 })) as { roots?: Obj[] } | null;
    const r = out?.roots?.[0];
    const rootRun = str(r?.["rootRun"]);
    const runId = str(r?.["runId"]) ?? rootRun;
    return rootRun === undefined || runId === undefined ? "none" : { rootRun, runId, full: r?.["full"] !== false };
  } catch (e) {
    return isAbsent(e) ? "none" : "failed";
  }
}

/** runs.tree.get nodes as RunNodes (the names the views read); a node with no id or an unknown status is dropped. */
export function nodesOf(out: unknown): RunNode[] {
  const nodes = (out as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((n: Obj) => {
    if (n === null || typeof n !== "object") return [];
    const id = str(n["id"]);
    const status = str(n["status"]);
    if (id === undefined || status === undefined || !STATUS.has(status)) return [];
    const sp = (n["spent"] ?? {}) as Obj;
    const wake = n["wake"] as Obj | undefined;
    return [
      {
        id,
        kind: str(n["kind"]) ?? "helper",
        status: status as RunNode["status"],
        spent: {
          tokensIn: num(sp["tokensIn"]) ?? 0,
          tokensOut: num(sp["tokensOut"]) ?? 0,
          cacheRead: num(sp["cacheRead"]) ?? 0,
          usdMicros: num(sp["usdMicros"]) ?? 0,
        },
        startedAt: num(n["startedAt"]) ?? 0,
        ...(str(n["parentRun"]) !== undefined ? { parentRun: str(n["parentRun"])! } : {}),
        ...(str(n["rootRun"]) !== undefined ? { rootRun: str(n["rootRun"])! } : {}),
        ...(str(n["name"]) !== undefined ? { name: str(n["name"])! } : {}),
        ...(str(n["model"]) !== undefined ? { model: str(n["model"])! } : {}),
        ...(str(n["summary"]) !== undefined ? { summary: str(n["summary"])! } : {}),
        ...(str(n["whoName"]) !== undefined ? { whoName: str(n["whoName"])! } : {}),
        ...(Array.isArray(n["dependsOn"]) ? { dependsOn: (n["dependsOn"] as unknown[]).filter((x): x is string => typeof x === "string") } : {}),
        ...(stepTextOf(n["step"]) !== undefined ? { step: stepTextOf(n["step"])! } : {}),
        ...(stepIconOf(n["step"]) !== undefined ? { stepIcon: stepIconOf(n["step"])! } : {}),
        ...(n["stuck"] && typeof n["stuck"] === "object" && str((n["stuck"] as Obj)["reason"]) !== undefined ? { stuck: { since: num((n["stuck"] as Obj)["since"]) ?? 0, reason: str((n["stuck"] as Obj)["reason"])! } } : {}),
        ...(needOf(n["need"]) ? { need: needOf(n["need"])! } : {}),
        ...(num(n["endedAt"]) !== undefined ? { endedAt: num(n["endedAt"])! } : {}),
        ...(wake
          ? {
              wake: {
                kind: str(wake["kind"]) ?? "event",
                ...(str(wake["label"]) !== undefined ? { label: str(wake["label"])! } : {}),
                ...(num(wake["dueAt"]) !== undefined ? { dueAt: num(wake["dueAt"])! } : {}),
                ...(num(wake["wokeCount"]) !== undefined ? { wokeCount: num(wake["wokeCount"])! } : {}),
              },
            }
          : {}),
      },
    ];
  });
}

export async function readTree(call: Call, runId: string): Promise<RunNode[] | null> {
  try {
    return nodesOf(await call("runs.tree.get", { runId }));
  } catch {
    return null;
  }
}
