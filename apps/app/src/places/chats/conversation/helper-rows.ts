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

/**
 * The agent's intro, the crew strip and its final answer read as one message (prototype p-crew): the short intro first, then the strip, then the answer below it. The strip's start lines come first in the chat and the agent's
 * words after them; this folds the plain agent text next to the strip into it. The intro is the text just after the strip's start (or just before it, when the agent spoke first). The answer is the plain agent text that follows,
 * and only once every helper of the strip has ended. A person's message, a card or another author's line ends the run.
 */
export function mergeCrewAnswer<M extends Msg & { author?: unknown; body: string }>(messages: readonly M[]): M[] {
  const author = (m: M): string => JSON.stringify((m as { author?: unknown }).author ?? "");
  const plain = (m: M): boolean => m.body.trim() !== "" && m.blocks.length === 0 && (m as { author?: { kind?: string } }).author?.kind === "agent";
  const out: M[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]!;
    const strip = m.blocks.find((b) => b.type === "crew_strip");
    const ownWords = m.body.trim() !== "" && m.blocks.length === 1 && (m as { author?: { kind?: string } }).author?.kind === "agent";
    if (!strip || (m.body.trim() !== "" && !ownWords) || m.blocks.length !== 1) { out.push(m); continue; }
    const who = author(m);
    const done = (((strip.data as { blocks?: Block[] } | undefined)?.blocks) ?? []).every((b) => ["done", "failed"].includes(String(rec(b.data)["status"])));
    let j = i + 1;
    const next = messages[j];
    // the intro: the plain line just before (already pushed) or just after the strip's start
    let intro: M | undefined;
    const prev = out[out.length - 1];
    if (ownWords) intro = m;
    else if (next && plain(next) && author(next) === who) { intro = next; j += 1; }
    else if (prev && plain(prev) && author(prev) === who) { intro = prev; out.pop(); }
    const answer: string[] = [];
    if (done) { while (j < messages.length && plain(messages[j]!) && author(messages[j]!) === who) { answer.push(messages[j]!.body.trim()); j += 1; } }
    if (!intro && answer.length === 0) { out.push(m); continue; }
    const base = intro ?? m;
    out.push({ ...base, body: intro ? intro.body : "", blocks: [{ ...strip, data: { ...(rec(strip.data)), ...(answer.length > 0 ? { after: answer.join("\n\n") } : {}) } }] });
    i = j - 1;
  }
  return out;
}

/**
 * A coder (a teammate) is a row of the strip, with its branch and change on it; nothing is posted per coder (owner, 5 Nov 2026). The line that says it started and the card that says it finished are left out of the
 * timeline once the strip holds that coder: `threads` are the coders' thread ids and `jobs` their job ids, from the crew read.
 */
export function hideCrewPosts<M extends Msg>(messages: readonly M[], threads: ReadonlySet<string>, jobs: ReadonlySet<string>): M[] {
  if (threads.size === 0 && jobs.size === 0) return [...messages];
  const mine = (b: Block): boolean => {
    const d = rec(b.data);
    return (b.type === "crew_result" && (jobs.has(String(d["jobId"])) || threads.has(String(d["threadId"])))) || (b.type === "helper" && d["crew"] === true && threads.has(String(d["helperThreadId"] ?? d["threadId"])));
  };
  return messages.flatMap((m) => {
    if (!m.blocks.some(mine)) return [m];
    const rest = m.blocks.filter((b) => !mine(b));
    // a line that held only the start or the result goes away; one that also carried words keeps them
    return rest.length === 0 && m.body.trim() === "" ? [] : rest.length === 0 && (m.blocks.some((b) => b.type === "crew_result")) ? [] : [{ ...m, blocks: rest }];
  });
}

/**
 * A crew of coders only (no helper started with it) has no strip to join. The start line of the first coder, inside the lead's own message, becomes the strip: the lead's words stay above it, and the coders' rows
 * come from the live crew read (the strip's block lists none of its own). Every other coder start line goes.
 */
export function stripFromCoders<M extends Msg>(messages: readonly M[], threads: ReadonlySet<string>): M[] {
  if (threads.size === 0 || messages.some((m) => m.blocks.some((b) => b.type === "crew_strip"))) return [...messages];
  const mine = (b: Block): boolean => b.type === "helper" && rec(b.data)["crew"] === true && threads.has(String(rec(b.data)["helperThreadId"] ?? rec(b.data)["threadId"]));
  const first = messages.findIndex((m) => m.blocks.some(mine));
  if (first < 0) return [...messages];
  return messages.flatMap((m, i) => {
    if (!m.blocks.some(mine)) return [m];
    const rest = m.blocks.filter((b) => !mine(b));
    if (i === first) return [{ ...m, blocks: [...rest, { type: "crew_strip", id: `strip-${m.messageId}`, data: { blocks: [] } }] }];
    return rest.length === 0 && m.body.trim() === "" ? [] : [{ ...m, blocks: rest }];
  });
}
