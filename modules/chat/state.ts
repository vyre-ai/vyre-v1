// What the `state` module needs to know about a chat, a one-to-one and a channel's own chat (one kind: `chat`, the thing is the thread id). With it a person can pin and mute them through state.set, and the sidebar
// reads their pins in their own order (state.list pinned). Unread is still counted by chat's own read cursors: this kind registers the entries so the state module can keep its own head, but chat does not call
// the seam's arrival yet (a later step), so `verify` is what brings them in. Registered through `stateKinds` in impl.ts.
import type { RawDb } from "../../host/src/ctx/db.ts";
import type { StateKind } from "../../host/src/seams/state.ts";

export const CHAT_THING = "chat";
export const chatThing = (threadId: string): { type: string; id: string } => ({ type: CHAT_THING, id: threadId });

type Row = Record<string, unknown>;
const rows = (db: RawDb, sql: string, ...args: unknown[]): Row[] => db.all(sql, ...args) as Row[];

export const chatKind: StateKind = {
  type: CHAT_THING,
  reopen: "mention",
  audience(db, id) {
    return rows(db, "SELECT principal FROM chat_thread_member WHERE thread = ? AND deleted_at IS NULL", id).map((r) =>
      String(r["principal"]),
    );
  },
  visible(db, id, person) {
    return (
      rows(
        db,
        "SELECT 1 AS x FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL",
        id,
        person,
      ).length > 0
    );
  },
  scope() {
    return "chats";
  },
  entries(db, id) {
    return rows(
      db,
      "SELECT threadSeq AS pos, author FROM chat_message WHERE thread = ? AND deleted_at IS NULL ORDER BY threadSeq",
      id,
    ).map((r) => ({
      pos: Number(r["pos"]),
      by: r["author"] === null || r["author"] === undefined ? null : String(r["author"]),
    }));
  },
  heads(db) {
    return rows(
      db,
      "SELECT thread AS thing, MAX(threadSeq) AS head, MAX(createdAt) AS at FROM chat_message WHERE deleted_at IS NULL GROUP BY thread",
    ).map((r) => ({
      thing: String(r["thing"]),
      head: Number(r["head"]),
      at: Number(r["at"]),
    }));
  },
};

/** The kinds this module offers the host (the loader reads `stateKinds` from impl.ts). */
export const stateKinds: StateKind[] = [chatKind];
