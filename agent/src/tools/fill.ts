// What the tool layer fills in for a model (13 Nov 2026, owner: "its first attempts are always failing"). A model writes a call from the tool's description alone. These are the inputs it cannot know or should not
// have to invent: the idempotency key a `create` capability requires, the chat it is in, and a title the page already carries. The model may still give any of them; what it gave is kept.
// Everything here is decided from the tool's own schema and the call's own context, never from a value in the input except the page's title.
import type { ToolCtx, ToolDef } from "./types.ts";

type Schema = { properties?: Record<string, { pattern?: string; type?: string }>; required?: string[] };
const schemaOf = (t: ToolDef): Schema => (t.inputSchema ?? {}) as Schema;

/** Capabilities that end, remove or move a chat: with no chat named they are not done to the one the model is in. */
const NOT_THIS_CHAT =
  /(?:^|[._])(?:delete|remove|archive|close|stop|drop|purge|revoke|interrupt|reject|restart|move|leave|stop_all)(?:[._]|$)/;

/** Does this tool's own schema name a chat (a `thr_` id) as its `threadId`, and is it safe to take the chat the model is in when it names none? */
export function fillsThread(t: Pick<ToolDef, "cap" | "inputSchema">): boolean {
  const p = (t.inputSchema as Schema | null)?.properties?.["threadId"];
  return p?.pattern === "^thr_[a-z0-9]+$" && !NOT_THIS_CHAT.test(t.cap);
}

/** A stable text of a value: keys sorted, so the same input always reads the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** A short stable hash of a text (FNV-1a, 32 bits, in hex): enough to tell two calls of one turn apart, never a secret. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const plain = (s: string): string =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : (ENTITY[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();

/** The title a page carries: its <title>, else its first <h1>. Null when it has neither (a title shared by two artifacts would make them one). */
export function pageTitle(html: string): string | null {
  const head = html.slice(0, 200_000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const t = m?.[1] ? plain(m[1]) : "";
    if (t !== "") return t.slice(0, 120);
  }
  return null;
}

/** The title of a published page from where it comes from: the page's own title, or the name of its folder or file. Null when nothing names it. */
export function titleFor(cap: string, input: Record<string, unknown>): string | null {
  if (cap !== "sites.artifact_publish") return null;
  if (typeof input["html"] === "string") return pageTitle(input["html"]);
  if (typeof input["path"] === "string") {
    const parts = input["path"].split(/[\\/]+/).filter((x) => x !== "");
    let last = parts.pop() ?? "";
    if (/^index\.html?$/i.test(last)) last = parts.pop() ?? "";
    const name = last
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return name === "" ? null : name.slice(0, 120);
  }
  return null;
}

/** Spellings a model uses for an input the tool names another way: a chat is a threadId. Snake case is read as camel case. Only a name the schema does not have is moved, and only to a name it does. */
const SYNONYMS: Readonly<Record<string, string>> = {
  chatId: "threadId",
  conversationId: "threadId",
  chat_id: "threadId",
  fileID: "fileId",
};

export interface Filled {
  input: unknown;
  /** What the tool layer added, by name. */
  filled: string[];
  /** What it read under another spelling: [given, tool's name]. */
  renamed: Array<[string, string]>;
}

/**
 * The input the capability gets: the model's own, with the spellings the tool names differently read as the tool's, and what the tool layer owns filled in. `n` counts this same call in this turn, so a call
 * repeated on purpose is a new call and the same call replayed after a restart is the same call.
 */
export function fillInput(t: ToolDef, input: unknown, ctx: ToolCtx, n: number): Filled {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { input, filled: [], renamed: [] };
  const props = schemaOf(t).properties ?? {};
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const filled: string[] = [];
  const renamed: Array<[string, string]> = [];
  const rename = (from: string, to: string): void => {
    if (from in out && !(from in props) && to in props && out[to] === undefined) {
      out[to] = out[from];
      delete out[from];
      renamed.push([from, to]);
    }
  };
  for (const [k] of Object.entries(out)) {
    if (k in props) continue;
    const camel = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    if (camel !== k) rename(k, camel);
    else if (SYNONYMS[k]) rename(k, SYNONYMS[k] as string);
  }
  // a bare `id` is the tool's one required id that is still missing, when there is exactly one
  if ("id" in out && !("id" in props)) {
    const missing = (schemaOf(t).required ?? []).filter((r) => /Id$/.test(r) && out[r] === undefined);
    if (missing.length === 1) rename("id", missing[0] as string);
  }
  if (
    "threadId" in props &&
    out["threadId"] === undefined &&
    fillsThread(t) &&
    /^thr_[a-z0-9]+$/.test(ctx.thread.threadId)
  ) {
    out["threadId"] = ctx.thread.threadId;
    filled.push("threadId");
  }
  if (out["title"] === undefined && "title" in props) {
    const title = titleFor(t.cap, out);
    if (title !== null) {
      out["title"] = title;
      filled.push("title");
    }
  }
  if (t.keyed === true && (typeof out["idempotencyKey"] !== "string" || out["idempotencyKey"] === "")) {
    // one call is one key: the call's own id when the engine has one (a retry of that call carries the same id, so it makes the same thing once; two calls the model makes on purpose have two ids). Only a call with
    // no id falls back to turn, tool, input and the count of that same call in the turn.
    out["idempotencyKey"] = ctx.callId
      ? `ag:${ctx.turnId ?? ""}:${ctx.callId}`
      : `ag:${ctx.turnId ?? ctx.trace?.traceId ?? "t"}:${t.name}:${shortHash(canonical({ ...out, idempotencyKey: undefined }))}:${n}`;
    filled.push("idempotencyKey");
  }
  return { input: out, filled, renamed };
}
