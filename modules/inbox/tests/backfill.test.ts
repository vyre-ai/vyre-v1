// The one-time start of per-person state on a Space that already has an Inbox (backfill.ts): read items are read for everyone who can see the conversation, unread items are unread for all of them,
// each person's place is set just before the oldest unread item, a dry run writes nothing, and running it twice changes nothing. Legacy data is what rc.26 left: items with no arrival number and a
// shared `unread` flag.
import test from "node:test";
import assert from "node:assert/strict";
import { rawDbOf } from "../../../host/src/ctx/db.ts";
import { stateSeamOf } from "../../../host/src/seams/state.ts";
import { backfill, finished } from "../backfill.ts";
import { periodic } from "../impl.ts";
import { linkMessage } from "../handlers/index.ts";
import { harness, LEE, link } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { readSeam, thingOf } from "../state.ts";

const MAYA = "usr_maya01";
const JONAS = "usr_jonas1";
const SHARED = "mbx_shared";

/** Items filed, then made to look like rc.26 left them: no arrival numbers, no state, the shared flag as it was. `flags` is the unread flag of each item, oldest first. */
async function legacy(h: Harness, address: string, flags: (0 | 1)[]): Promise<string> {
  let id = "";
  for (let i = 0; i < flags.length; i++)
    id = (await linkMessage(h.ctx, link({ address, mailboxId: SHARED }))).conversationId;
  const items = h.rows(`SELECT id FROM inbox_item WHERE "conversationId" = ? ORDER BY at, id`, id);
  items.forEach((r, i) => h.ctx.db.run(`UPDATE inbox_item SET unread = ? WHERE id = ?`, flags[i]!, r.id));
  return id;
}
function asLegacy(h: Harness): void {
  const raw = rawDbOf(h.ctx.db)!;
  h.ctx.db.run(`UPDATE inbox_item SET arrival = NULL`);
  h.ctx.db.run(`DELETE FROM inbox_flag`);
  for (const t of ["state_person", "state_thing", "state_count"]) raw.run(`DELETE FROM ${t}`);
}
const dump = (h: Harness): string =>
  JSON.stringify(
    ["state_person", "state_thing", "state_count"].map((t) =>
      rawDbOf(h.ctx.db)!.all(`SELECT * FROM ${t} ORDER BY 1, 2, 3`),
    ),
  );
const unread = (h: Harness, who: string, id: string): number => readSeam(h.ctx).stateOf(who, [thingOf(id)])[0]!.unread;

function world() {
  const h = harness({ contacts: [{ ...LEE }], people: [MAYA, JONAS] });
  return { h };
}

test("read items are read for everyone, unread items are unread for everyone, from the oldest unread", async () => {
  const { h } = world();
  const a = await legacy(h, "pat@acme.test", [0, 0, 1]);
  const b = await legacy(h, "who@nowhere.test", [0, 0]);
  asLegacy(h);
  const r = await backfill(h.ctx, { dryRun: false });
  assert.equal(r.alreadyDone, false);
  assert.equal(r.numbered, 5, "every item got an arrival number");
  assert.equal(r.conversations, 2);
  for (const who of [MAYA, JONAS]) {
    assert.equal(unread(h, who, a), 1, `${who}: the one unread item`);
    assert.equal(unread(h, who, b), 0, `${who}: nothing unread, and no badge for old read mail`);
  }
  assert.deepEqual(r.perScope[`mailbox:${SHARED}`], { conversations: 2, people: 4, unreadRows: 2 });
  assert.equal(finished(h.ctx), true);
});

test("arrival numbers follow the order the items were filed", async () => {
  const { h } = world();
  await legacy(h, "pat@acme.test", [0, 0, 1]);
  asLegacy(h);
  await backfill(h.ctx, { dryRun: false });
  const rows = h.rows(`SELECT arrival FROM inbox_item ORDER BY at, id`);
  assert.deepEqual(
    rows.map((x) => x.arrival),
    [1, 2, 3],
  );
});

test("a conversation whose unread items are not the newest becomes unread from the oldest, and the report lists it", async () => {
  const { h } = world();
  const c = await legacy(h, "pat@acme.test", [1, 0, 1]); // the middle one was read, the oldest and the newest not
  const d = await legacy(h, "who@nowhere.test", [0, 1]); // the unread one is the newest: nothing odd
  asLegacy(h);
  const r = await backfill(h.ctx, { dryRun: false });
  assert.deepEqual(r.anomalies, [c]);
  assert.equal(unread(h, MAYA, c), 3, "unread from the oldest: all three");
  assert.equal(unread(h, MAYA, d), 1);
});

test("a dry run writes nothing and says what a real run would do", async () => {
  const { h } = world();
  await legacy(h, "pat@acme.test", [0, 1]);
  asLegacy(h);
  const before = JSON.stringify(h.rows(`SELECT * FROM inbox_item ORDER BY id`));
  const r = await backfill(h.ctx, { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.numbered, 2);
  assert.equal(r.conversations, 1);
  assert.equal(r.sample.length, 1);
  assert.equal(r.sample[0]!.people, 2);
  assert.equal(JSON.stringify(h.rows(`SELECT * FROM inbox_item ORDER BY id`)), before, "no item was numbered");
  assert.equal(dump(h), JSON.stringify([[], [], []]), "no state was made");
  assert.equal(finished(h.ctx), false);
});

test("running it twice changes nothing", async () => {
  const { h } = world();
  await legacy(h, "pat@acme.test", [0, 1]);
  await legacy(h, "who@nowhere.test", [1]);
  asLegacy(h);
  await backfill(h.ctx, { dryRun: false });
  const once = dump(h);
  const items = JSON.stringify(h.rows(`SELECT * FROM inbox_item ORDER BY id`));
  const again = await backfill(h.ctx, { dryRun: false });
  assert.equal(again.alreadyDone, true);
  assert.equal(dump(h), once);
  assert.equal(JSON.stringify(h.rows(`SELECT * FROM inbox_item ORDER BY id`)), items);
  // even without the flag, a person who has a row keeps it and nothing is made twice
  h.ctx.db.run(`DELETE FROM inbox_flag`);
  const third = await backfill(h.ctx, { dryRun: false });
  assert.equal(third.rowsMade, 0);
  assert.equal(dump(h), once);
});

test("a Space with nothing in its Inbox finishes at once, so a later run never starts from the old flag", async () => {
  const { h } = world();
  const r = await backfill(h.ctx, { dryRun: false });
  assert.equal(r.conversations, 0);
  assert.equal(finished(h.ctx), true);
});

// ---- the window between the upgrade and the backfill, and a list of people that cannot be read

test("a mail filed after the upgrade and before the backfill is numbered after the old ones and counted once, by the backfill", async () => {
  const { h } = world();
  const a = await legacy(h, "pat@acme.test", [0, 0, 1]);
  asLegacy(h);
  // the server is up, the backfill has not run: a new mail arrives
  await linkMessage(h.ctx, link({ address: "pat@acme.test", mailboxId: SHARED }));
  const numbers = h.rows(`SELECT arrival FROM inbox_item ORDER BY at, id`).map((r) => r.arrival);
  assert.deepEqual(numbers, [1, 2, 3, 4], "the old items were numbered first, the new one is after them");
  assert.equal(
    rawDbOf(h.ctx.db)!.all(`SELECT 1 FROM state_person`).length,
    0,
    "nothing is counted yet: the backfill reads the conversation as it is, the new mail included",
  );
  await backfill(h.ctx, { dryRun: false });
  assert.equal(unread(h, MAYA, a), 2, "the old unread one and the new one: not 1");
  assert.equal(unread(h, JONAS, a), 2);
  assert.deepEqual(readSeam(h.ctx).verify({ deep: true }).problems, [], "and the verify agrees");
  // from here on a mail is counted when it arrives
  await linkMessage(h.ctx, link({ address: "pat@acme.test", mailboxId: SHARED }));
  assert.equal(unread(h, MAYA, a), 3);
});

test("a backfill that cannot read the list of people has not run: no flag, a plain line in the log, and the next run does it", async () => {
  const { h } = world();
  const a = await legacy(h, "pat@acme.test", [0, 1]);
  asLegacy(h);
  const lines: string[] = [];
  h.ctx.log = { info() {}, warn: (m) => void lines.push(m) };
  h.failPeople(true);
  await periodic["inbox.state_backfill"].run(h.ctx);
  assert.equal(finished(h.ctx), false, "not marked done");
  assert.equal(rawDbOf(h.ctx.db)!.all(`SELECT 1 FROM state_person`).length, 0, "nothing written: no silent zero");
  assert.equal(h.rows(`SELECT 1 FROM inbox_item WHERE arrival IS NOT NULL`).length, 0, "not even the numbering");
  assert.match(lines.join("\n"), /per-person state has not started: the list of people could not be read/);
  assert.equal(periodic["inbox.state_backfill"].everyMs <= 10 * 60_000, true, "and it tries again within minutes, not a day");
  h.failPeople(false);
  await periodic["inbox.state_backfill"].run(h.ctx);
  assert.equal(finished(h.ctx), true);
  for (const who of [MAYA, JONAS]) assert.equal(unread(h, who, a), 1, `${who} has what they had`);
});

test("a mail filed while the list of people cannot be read is counted later by verify, for everyone", async () => {
  const { h } = world();
  h.failPeople(true);
  const c = (await linkMessage(h.ctx, link({ address: "pat@acme.test", mailboxId: SHARED }))).conversationId;
  assert.equal(rawDbOf(h.ctx.db)!.all(`SELECT 1 FROM state_person`).length, 0, "no half-counted arrival for the owner alone");
  h.failPeople(false);
  const env = { people: [MAYA, JONAS], mayView: () => true };
  stateSeamOf(h.ctx.db, () => 0, env).verify({ repair: true });
  assert.equal(unread(h, MAYA, c), 1);
  assert.equal(unread(h, JONAS, c), 1);
});
