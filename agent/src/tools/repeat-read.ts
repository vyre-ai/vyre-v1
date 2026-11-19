// A read an agent makes again in the same turn, and finds unchanged, is answered with one line instead of the same pages a second time (r42-runtime-tokens, DIRECTION-agent-runtime C: references, not content).
// Only the SAME agent in the SAME turn, and only where its earlier result is certain to be in view: the API driver (ToolCtx.repeatSafe), until it compacts the conversation or the turn is resumed (reads-epoch.ts forgets the turn's reads then). A CLI engine's own session can compact unseen, so it never gets the line. The call still reaches the server and passes the same access
// check, so a thing that changed, or that the agent may no longer read, is answered as it would be. Nothing is shared between agents: another helper must see the content itself to use it.
import { createHash } from "node:crypto";
import { canonical } from "./fill.ts";
import { readsEpoch } from "./reads-epoch.ts";
import type { ToolCtx } from "./types.ts";

/** The reads of one thing by its own tool: a second read of the same thing in a turn is the repeat this catches. */
const ONE_THING: ReadonlySet<string> = new Set([
  "files.read",
  "records.get",
  "tasks.get",
  "notes.get",
  "memory.page.get",
  "sheets.read_rows",
  "mail.message.get",
  "mail.thread.get",
  "inbox.thread",
  "calendar.get_event",
  "goals.get",
  "sites.get",
  "automations.get",
]);
/** A result smaller than this is sent again as it is: the line would cost nearly as much as the content. */
export const REPEAT_MIN_BYTES = 1_500;
const MAX_TURNS = 200;
const MAX_READS = 200;

interface Seen {
  fingerprint: string;
  bytes: number;
  tool: string;
}

export class RepeatReads {
  private readonly turns = new Map<string, Map<string, Seen>>();

  /**
   * Remember this read; when the same agent read the same thing earlier in this turn and the answer is byte for byte the same, return what to say instead. A call with no turn id (a CLI engine's session
   * with none to name) is never shortened: without a turn there is no end to the earlier result being in view.
   */
  check(
    ctx: ToolCtx,
    tool: string,
    cap: string,
    input: unknown,
    output: unknown,
  ): { bytes: number; tool: string } | null {
    if (!ONE_THING.has(cap) || ctx.turnId === undefined || ctx.repeatSafe !== true) return null;
    const text = canonical(output);
    if (text.length < REPEAT_MIN_BYTES) return null;
    const turn = `${ctx.thread.threadId}|${ctx.agentId}|${ctx.turnId}|${readsEpoch(ctx.turnId)}`;
    let reads = this.turns.get(turn);
    if (!reads) {
      reads = new Map();
      this.turns.set(turn, reads);
      if (this.turns.size > MAX_TURNS) this.turns.delete(this.turns.keys().next().value as string);
    }
    const key = `${cap}:${createHash("sha256").update(canonical(input)).digest("hex")}`;
    const fingerprint = createHash("sha256").update(text).digest("hex");
    const was = reads.get(key);
    if (was && was.fingerprint === fingerprint) return { bytes: was.bytes, tool: was.tool };
    reads.delete(key);
    reads.set(key, { fingerprint, bytes: text.length, tool });
    if (reads.size > MAX_READS) reads.delete(reads.keys().next().value as string);
    return null;
  }
}

/** What the model reads instead of the same content again. */
export const repeatLine = (tool: string, bytes: number): { unchanged: true; message: string } => ({
  unchanged: true,
  message: `This is the same ${tool} answer you already have from earlier in this turn (${bytes.toLocaleString("en-US")} bytes), and nothing in it has changed. Use that one.`,
});
