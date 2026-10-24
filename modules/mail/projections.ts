// mail projections. Unread is a per-mailbox count on the local copy.
// Ingest calls bumpUnread directly while status is stub: the host does not run
// module projections yet. Leave `inline` unwired until that direct write is removed.
import type { MailDb } from "./fixtures/db.ts";
import { first, num } from "./fixtures/db.ts";

export function bumpUnread(db: MailDb, mailboxId: string): void {
  const row = first(db.all(`SELECT n FROM mail_unread WHERE "mailboxId" = ?`, mailboxId));
  if (!row) {
    db.run(`INSERT INTO mail_unread ("mailboxId", n) VALUES (?, ?)`, mailboxId, 1);
    return;
  }
  db.run(`UPDATE mail_unread SET n = ? WHERE "mailboxId" = ?`, num(row, "n") + 1, mailboxId);
}

export const inline = {
  "mail.received"(db: MailDb, payload: { mailboxId?: string }): void {
    if (payload.mailboxId) bumpUnread(db, payload.mailboxId);
  },
};

export const consumers = {};
export const codecs = {};
