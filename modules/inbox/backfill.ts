// The one-time start of per-person state on a Space that already has an Inbox (contract P2, section 4): what the shared read flag said becomes each person's own place.
//   items with unread = 0 count as read for everyone who can see the conversation (someone read them; marking them unread for everyone would show a flood);
//   items with unread = 1 are unread for all of them (nobody had read them); each person's place is set just before the oldest unread item.
//   Nobody gets a badge for old read mail. A person who never saw a mail someone else read loses that cue: the one accepted loss.
//   A conversation whose unread items are not the newest ones (a merge can make that) becomes "unread from the oldest"; the report lists them. Done starts empty.
// The run is idempotent (a person who already has a row is left alone, a flag row says it finished) and reports before it writes: `dryRun` writes nothing, and the start logs the plan it is about to apply.
import { stateSeamOf } from "../../host/src/seams/state.ts";
import type { Thing } from "../../host/src/seams/state.ts";
import { first, itemsOf, num, rowsOf, str } from "./projections.ts";
import type { InboxCtx, Row } from "./projections.ts";
import { conversationKind, envOf, rawOf, thingOf } from "./state.ts";

const KEY = "state_backfill";
const SAMPLE = 5;
const ANOMALY_LIST = 20;

export interface BackfillReport {
  dryRun: boolean;
  /** the run had already finished on this Space and did nothing (a dry run reads the data again whatever the flag says) */
  alreadyDone: boolean;
  conversations: number;
  /** items that had no arrival number and now have one (or would) */
  numbered: number;
  rowsMade: number;
  perScope: Record<string, { conversations: number; people: number; unreadRows: number }>;
  /** conversations whose unread items are not the newest ones; they become "unread from the oldest" */
  anomalies: string[];
  sample: { conversation: string; scope: string; head: number; readUpto: number; people: number }[];
}

/** Has the backfill finished on this Space? */
export const finished = (ctx: InboxCtx): boolean =>
  first(ctx.db.all(`SELECT "key" FROM inbox_flag WHERE "key" = ?`, KEY)) !== null;

/** Give every item without an arrival number one, in the order it was filed (time, then id), after the highest number there is. Returns what it gave, by id; with `write` false nothing is written. */
function numberItems(ctx: InboxCtx, write: boolean): Map<string, number> {
  const base = num(first(ctx.db.all(`SELECT COALESCE(MAX(arrival), 0) AS n FROM inbox_item`)), "n");
  const missing = rowsOf(ctx.db.all(`SELECT id FROM inbox_item WHERE arrival IS NULL ORDER BY at, id`)).map((r) =>
    str(r, "id"),
  );
  const given = new Map(missing.map((id, i) => [id, base + i + 1]));
  if (write && missing.length > 0)
    ctx.db.run(
      `UPDATE inbox_item SET arrival = r.rn + ? FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY at, id) AS rn FROM inbox_item WHERE arrival IS NULL) AS r WHERE r.id = inbox_item.id`,
      base,
    );
  return given;
}

export async function backfill(ctx: InboxCtx, o: { dryRun: boolean }): Promise<BackfillReport> {
  const report: BackfillReport = {
    dryRun: o.dryRun,
    alreadyDone: false,
    conversations: 0,
    numbered: 0,
    rowsMade: 0,
    perScope: {},
    anomalies: [],
    sample: [],
  };
  if (!o.dryRun && finished(ctx)) return { ...report, alreadyDone: true };
  const virtual = numberItems(ctx, !o.dryRun);
  report.numbered = virtual.size;
  const env = await envOf(ctx, { people: true });
  const raw = rawOf(ctx);
  const store = stateSeamOf(ctx.db, ctx.now, env);
  const conversations = rowsOf(ctx.db.all(`SELECT * FROM inbox_conversation WHERE deleted_at IS NULL ORDER BY id`));
  for (const conv of conversations) {
    const id = str(conv, "id");
    // the entries as the Inbox files them: inbound items, with the position each has (or is about to have)
    const items = itemsOf(ctx, conv, "direction = ?", "in").map((i: Row) => ({
      pos: num(i, "arrival") || virtual.get(str(i, "id")) || 0,
      at: num(i, "at"),
      unread: num(i, "unread") === 1,
    }));
    if (items.length === 0) continue;
    report.conversations += 1;
    const head = Math.max(...items.map((i) => i.pos));
    const unreadPos = items.filter((i) => i.unread).map((i) => i.pos);
    const oldestUnread = unreadPos.length ? Math.min(...unreadPos) : null;
    const readUpto = oldestUnread === null ? head : oldestUnread - 1;
    if (
      oldestUnread !== null &&
      items.some((i) => !i.unread && i.pos > oldestUnread) &&
      report.anomalies.length < ANOMALY_LIST
    )
      report.anomalies.push(id);
    const people = conversationKind.audience(raw, id, env);
    const scope = conversationKind.scope(raw, id);
    const slot = (report.perScope[scope] ??= { conversations: 0, people: 0, unreadRows: 0 });
    slot.conversations += 1;
    slot.people += people.length;
    if (oldestUnread !== null) slot.unreadRows += people.length;
    if (report.sample.length < SAMPLE)
      report.sample.push({ conversation: id, scope, head, readUpto, people: people.length });
    if (!o.dryRun) {
      const thing: Thing = thingOf(id);
      report.rowsMade += store.seed(
        thing,
        Math.max(...items.map((i) => i.at)),
        new Map(people.map((p) => [p, readUpto])),
      );
    }
  }
  if (!o.dryRun) ctx.db.run(`INSERT OR IGNORE INTO inbox_flag ("key", "at") VALUES (?, ?)`, KEY, ctx.now());
  return report;
}
