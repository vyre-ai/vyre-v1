// What the chat module remembers about how a chat got its name: made by Vyre from the first real request ("auto", thin when that request was a few words, remade once), or given by a person ("user").
import { ensure } from "../projections.ts";
import type { ChatCtx, Db } from "../projections.ts";

const TABLE = 'CREATE TABLE IF NOT EXISTS "chat_title_state" ("thread" TEXT PRIMARY KEY, "source" TEXT NOT NULL, "thin" INTEGER NOT NULL DEFAULT 0, "remade" INTEGER NOT NULL DEFAULT 0, "at" INTEGER NOT NULL)';
const ready = new WeakSet<object>();
export function ensureTitleState(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  db.run(TABLE);
  ready.add(db);
}

/** A person renamed the chat: this title is theirs for good. */
export function markRenamed(ctx: ChatCtx, threadId: string): void {
  ensureTitleState(ctx.db);
  ctx.db.run('INSERT INTO "chat_title_state" ("thread", "source", "thin", "remade", "at") VALUES (?, \'user\', 0, 0, ?) ON CONFLICT("thread") DO UPDATE SET "source" = \'user\', "at" = excluded."at"', threadId, ctx.now());
}

