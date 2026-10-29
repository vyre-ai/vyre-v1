// Screen context (CHAT-DESIGN, Ask Vyre): the place a person sends a message from tells the agent where they are, as structured ids and titles, never content.
//   chat.post { screen }    stored with the message, only for a person, only in the shape of agent/src/turn-engine/context.ts parseScreen (anything else is dropped)
//   chat.screen.get         the screen the caller sent with a message (or the newest in the thread): a person reads only their own, so a channel never shows one member's screen to another
// The agent reads the objects themselves through its tools as the asker, so this widens no access. The rows go with the thread when it is erased.
import { parseScreen } from "../../../agent/src/turn-engine/context.ts";
import type { ScreenContext } from "../../../agent/src/turn-engine/context.ts";
import { askerOf, ensure, raise, threadBy } from "../projections.ts";
import type { ChatCtx, Db } from "../projections.ts";
import { canSpeak } from "./post.ts";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chat_screen (
    message TEXT PRIMARY KEY, thread TEXT NOT NULL, person TEXT NOT NULL, json TEXT NOT NULL, at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS chat_screen__thread ON chat_screen (thread, person, at)",
];
const ready = new WeakSet<object>();
function ensureScreen(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  for (const stmt of SCHEMA) db.run(stmt);
  ready.add(db);
}

/** Keep the screen a person sent with a message. A value that is not a screen context is dropped without an error: the message goes on. */
export function saveScreen(ctx: ChatCtx, threadId: string, messageId: string, raw: unknown): void {
  if (raw === undefined || ctx.principal.kind === "agent") return;
  const screen = parseScreen(raw);
  if (!screen) return;
  ensureScreen(ctx.db);
  ctx.db.run("INSERT OR REPLACE INTO chat_screen (message, thread, person, json, at) VALUES (?, ?, ?, ?, ?)", messageId, threadId, askerOf(ctx), JSON.stringify(screen), ctx.now());
}

export async function screenGet(ctx: ChatCtx, input: { threadId: string; messageId?: string }): Promise<{ screen: ScreenContext | null; messageId?: string }> {
  ensureScreen(ctx.db);
  const t = threadBy(ctx.db, input.threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  const person = askerOf(ctx);
  const row = (input.messageId !== undefined
    ? ctx.db.all("SELECT message, json FROM chat_screen WHERE thread = ? AND person = ? AND message = ?", input.threadId, person, input.messageId)
    : ctx.db.all("SELECT message, json FROM chat_screen WHERE thread = ? AND person = ? ORDER BY at DESC, message DESC LIMIT 1", input.threadId, person)) as Array<Record<string, unknown>>;
  const r = row[0];
  if (!r) return { screen: null };
  try { return { screen: JSON.parse(String(r["json"])) as ScreenContext, messageId: String(r["message"]) }; } catch { return { screen: null }; }
}

export const screenHandlers = { "chat.screen.get": screenGet };
