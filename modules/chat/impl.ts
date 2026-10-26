// chat module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { recentWithUnread } from "./handlers/g26.ts";
import type { ChatCtx } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it (P-L7_21). The host runs them with this module's ctx, so no other module
 * reads these tables. `owned_by` answers { <kind>: { count, sample, ids } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type OwnedRow = Record<string, unknown>;
const ownedRows = (ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } }, sql: string, ...a: unknown[]): OwnedRow[] => { try { return ctx.db.all(sql, ...a) as OwnedRow[]; } catch { return []; } };
const ownedKept = (r: OwnedRow[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });

const PRIVATE_CHATS = `FROM chat_thread t WHERE t."kind" IN ('chat', 'ask') AND t."starter" = ? AND t."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM chat_thread_member m WHERE m."thread" = t."id" AND m."principal" <> t."starter" AND m."principal" LIKE 'usr\\_%' ESCAPE '\\' AND m."deleted_at" IS NULL)`;

export const hostCalls = {
  "chat.owned_by": (ctx: ChatCtx, i: { person: string }) => ({
    channels: ownedKept(ownedRows(ctx, `SELECT "id", "name" FROM chat_channel WHERE "createdBy" = ? AND "archived" = 0`, i.person), "channel", "name"),
    private_chats: ownedKept(ownedRows(ctx, `SELECT t."id" AS "id", COALESCE(t."title", 'Chat') AS "title" ${PRIVATE_CHATS}`, i.person), "chat", "title"),
  }),
  "chat.reassign_owned": (ctx: ChatCtx, i: { person: string; kind: string; action: string; to?: string }): number => {
    const now = ctx.now();
    try {
      if (i.kind === "channels" && i.action === "reassign" && i.to) {
        const mine = ownedRows(ctx, `SELECT "id", "mainThread" FROM chat_channel WHERE "createdBy" = ? AND "archived" = 0`, i.person);
        for (const c of mine) {
          const thread = String(c["mainThread"]);
          const there = ownedRows(ctx, `SELECT "id" FROM chat_thread_member WHERE "thread" = ? AND "principal" = ? AND "deleted_at" IS NULL`, thread, i.to)[0];
          if (there) ctx.db.run(`UPDATE chat_thread_member SET "role" = 'owner', "updated_at" = ? WHERE "id" = ?`, now, String(there["id"]));
          else ctx.db.run(`INSERT INTO chat_thread_member (id, thread, principal, role, version, updated_at, deleted_at) VALUES (?, ?, ?, 'owner', 0, ?, NULL)`, `thm_${thread.slice(-12)}${now.toString(36)}`, thread, i.to, now);
          ctx.db.run(`UPDATE chat_thread_member SET "role" = 'member', "updated_at" = ? WHERE "thread" = ? AND "principal" = ?`, now, thread, i.person);
        }
        return ctx.db.run(`UPDATE chat_channel SET "createdBy" = ?, "updatedAt" = ? WHERE "createdBy" = ? AND "archived" = 0`, i.to, now, i.person).changes;
      }
      if (i.kind === "private_chats" && i.action === "delete") {
        const ids = ownedRows(ctx, `SELECT t."id" AS "id" ${PRIVATE_CHATS}`, i.person).map((r) => String(r["id"]));
        for (const id of ids) {
          ctx.db.run(`UPDATE chat_message SET "deleted_at" = ?, "updated_at" = ? WHERE "thread" = ? AND "deleted_at" IS NULL`, now, now, id);
          ctx.db.run(`UPDATE chat_thread SET "deleted_at" = ?, "updated_at" = ?, "closedAt" = COALESCE("closedAt", ?) WHERE "id" = ?`, now, now, now, id);
        }
        return ids.length;
      }
    } catch { /* no table yet: nothing to move */ }
    return 0;
  },
  /** What the Space switcher shows as unread on this person's tile: their unread messages across the chats they are in (spaces.attention). */
  "chat.attention": async (ctx: ChatCtx): Promise<number> => {
    try {
      const r = (await recentWithUnread(ctx, {})) as Record<string, Array<{ unread?: number }>>;
      return ["starred", "today", "yesterday", "earlier"].reduce((n, k) => n + (r[k] ?? []).reduce((m, t) => m + Number(t.unread ?? 0), 0), 0);
    } catch { return 0; }
  },
};
