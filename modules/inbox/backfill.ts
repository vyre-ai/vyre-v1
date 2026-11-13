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
import { peopleOf, stateEnvOf } from "../../host/src/seams/state-env.ts";
import { conversationKind, finished, markFinished, numberLegacy, rawOf, thingOf } from "./state.ts";

export { finished };

const SAMPLE = 5;
const ANOMALY_LIST = 20;

export interface BackfillReport {
  dryRun: boolean;
  /** the run had already finished on this Space and did nothing (a dry run reads the data again whatever the flag says) */
  alreadyDone: boolean;
  /** why the run did not start: the Space's list of people could not be read, so who can see what is not known. Nothing was written and nothing is marked done; the next run tries again. */
  deferred?: string;
  conversations: number;
  /** items that had no arrival number and now have one (or would) */
  numbered: number;
  rowsMade: number;
  perScope: Record<string, { conversations: number; people: number; unreadRows: number }>;
  /** conversations whose unread items are not the newest ones; they become "unread from the oldest" */
  anomalies: string[];
  sample: { conversation: string; scope: string; head: number; readUpto: number; people: number }[];
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
  // Everything that waits comes first. After the people are known the run reads, numbers and writes without giving up the thread, so an item filed while it runs cannot slip between its steps (an item
  // filed before it, while the list was being read, is read like the rest, and its arrival is made later by `verify` if it was not counted).
  const people = await peopleOf(ctx);
  if (people.length === 0) return { ...report, deferred: "the list of people could not be read" };
  const env = { ...(await stateEnvOf(ctx)), people };
  const virtual = numberLegacy(ctx, !o.dryRun);
  report.numbered = virtual.size;
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
    const reach = conversationKind.audience(raw, id, env);
    const scope = conversationKind.scope(raw, id);
    const slot = (report.perScope[scope] ??= { conversations: 0, people: 0, unreadRows: 0 });
    slot.conversations += 1;
    slot.people += reach.length;
    if (oldestUnread !== null) slot.unreadRows += reach.length;
    if (report.sample.length < SAMPLE)
      report.sample.push({ conversation: id, scope, head, readUpto, people: reach.length });
    if (!o.dryRun) {
      const thing: Thing = thingOf(id);
      report.rowsMade += store.seed(
        thing,
        Math.max(...items.map((i) => i.at)),
        new Map(reach.map((p) => [p, readUpto])),
      );
    }
  }
  if (!o.dryRun) markFinished(ctx);
  return report;
}
