// One row per helper (owner, 4 Nov 2026). A helper starts as a line in the chat with a card, and when it ends it reports back with a second message that carries the same helper (the lead wakes on it). The
// person sees one row, updated in place: the start line's card takes the ending state and one line of what the helper found, and the report is not drawn as a second card or a pasted reply.

interface Block { type: string; id?: string; state?: string; data?: unknown; [k: string]: unknown }
interface Msg { messageId: string; body: string; createdAt?: number; blocks: Block[] }

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** One line of what a helper found: its words after "found:", the first sentence, short. */
export function foundLine(body: string): string {
  const text = body.replace(/^Helper ".*?" (found:|could not finish\.?|was stopped[^\n]*)\s*/s, "").replace(/\s+/g, " ").trim();
  if (text === "" || text === "(it ended with no words)") return "";
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}

const helperOf = (m: Msg): Block | undefined => m.blocks.find((b) => b.type === "helper" && rec(b.data)["crew"] !== true);
const isReport = (b: Block | undefined): boolean => b !== undefined && ["done", "failed"].includes(String(rec(b.data)["status"])) && typeof rec(b.data)["threadId"] === "string" && rec(b.data)["helperThreadId"] === undefined;

export function foldHelperRows<M extends Msg>(messages: readonly M[]): M[] {
  const reports = new Map<string, M>();
  for (const m of messages) { const b = helperOf(m); if (isReport(b)) reports.set(String(rec(b!.data)["threadId"]), m); }
  const starts = new Set<string>();
  for (const m of messages) { const d = rec(helperOf(m)?.data); if (typeof d["helperThreadId"] === "string") starts.add(d["helperThreadId"]); }
  const out: M[] = [];
  for (const m of messages) {
    const b = helperOf(m);
    const d = rec(b?.data);
    if (isReport(b) && starts.has(String(d["threadId"]))) continue;
    if (!b || typeof d["helperThreadId"] !== "string") { out.push(m); continue; }
    const tid = String(d["helperThreadId"]);
    const report = reports.get(tid);
    const rd = report ? rec(helperOf(report)?.data) : {};
    const status = report ? String(rd["status"]) : "running";
    const patched: Block = {
      ...b, ...(report ? { state: status === "failed" ? "error" : "done" } : {}),
      data: { ...d, threadId: tid, status, ...(report ? { found: foundLine(report.body), ...(report.createdAt !== undefined ? { finishedAt: report.createdAt } : {}) } : {}), ...(m.createdAt !== undefined ? { startedAt: m.createdAt } : {}) },
    };
    out.push({ ...m, body: "", blocks: m.blocks.map((x) => (x === b ? patched : x)) });
  }
  return out;
}


/**
 * Helpers started one after another by the same agent are one strip, not a stack of cards (prototype p-crew). The first start line carries one `crew_strip` block that lists every helper's block; the others
 * leave the timeline. Only lines that hold nothing but a helper start group, so the agent's own words stay where they are. A crew teammate's start is not a helper and is left alone.
 */
export function groupHelperStrips<M extends Msg & { author?: unknown }>(messages: readonly M[]): M[] {
  const startOf = (m: M): Block | undefined => {
    const b = helperOf(m);
    return b && typeof rec(b.data)["helperThreadId"] === "string" && m.blocks.every((x) => x === b) ? b : undefined;
  };
  const out: M[] = [];
  let run: { first: M; blocks: Block[]; who: string } | null = null;
  const flush = (): void => {
    if (!run) return;
    out.push({ ...run.first, blocks: [{ type: "crew_strip", id: `strip-${run.first.messageId}`, data: { blocks: run.blocks } }] });
    run = null;
  };
  for (const m of messages) {
    const b = startOf(m);
    const who = JSON.stringify((m as { author?: unknown }).author ?? "");
    if (b && run && run.who === who) { run.blocks.push(b); continue; }
    flush();
    if (b) { run = { first: m, blocks: [b], who }; continue; }
    out.push(m);
  }
  flush();
  return out;
}
