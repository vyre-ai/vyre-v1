// A view of what people may see that many records were added to (a sync, a start) is built in slices with a turn for other requests between, and nobody is ever served half of it or an old one: a person who asks in
// the middle waits for the whole view, a share or a revoke that lands before, during or after the build is there when it is done, and a build the access state moved past is thrown away. Real server-role daemon.
// How long the loop is held, at 50,000 records, is measured in test/access.share-call.perf.test.ts (speed numbers count only on the perf runners).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { shareKept, sliceHook, sliceTuning } from "../modules/access/handlers/share.ts";
import { asKeptWriter } from "../modules/access/projections.ts";

let h: Hour;
let m: Person;
// slicing starts at 2,000 resource-people in the product; the test lowers it so a round of a hundred new records is enough (a CI runner has 30 s for the whole file)
const ROUND = 100;
before(async () => {
  sliceTuning.from = 150;
  h = await bootHour("kvchunk");
});
after(async () => {
  sliceTuning.from = 2000;
  await h?.stop();
});

const contacts = async (p: { call(cap: string, input?: Record<string, unknown>): Promise<any> }) =>
  (await p.call("access.lists", { type: "record", limit: 5 })) as {
    rows: Array<{ id: string }>;
    total: number;
  };

test(
  "a view that many records were added to is built in slices, served whole, and never older than a revoke",
  { timeout: 120_000 },
  async () => {
    const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const inv = await h.owner.call("members.invites.create", {
      role: roles.find((r) => r.name === "Member")!.id,
      email: "mia@firm.test",
    });
    m = h.person("Mia Moss", "mia", "mia@firm.test", "mia horse battery staple 9");
    await join(h, m, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });

    let batch = 0;
    let total = 0;
    const add = async (n: number): Promise<void> => {
      for (let left = n; left > 0; left -= 500, batch++)
        await h.owner.call("records.bulk_upsert", {
          type: "contact",
          match: ["email"],
          createOnly: true,
          idempotencyKey: `kvc-${batch}`,
          rows: Array.from({ length: Math.min(500, left) }, (_, i) => ({
            name: `Person ${batch}-${i}`,
            email: `p${batch}-${i}@kv.test`,
          })),
        });
      total += n;
    };
    const find = async (email: string): Promise<string> =>
      (
        (await h.owner.call("records.query", {
          type: "contact",
          filter: { field: "email", op: "eq", value: email },
          limit: 1,
        })) as { rows: Array<{ id: string }> }
      ).rows[0]!.id;
    const share = (id: string, key: string) =>
      h.owner.call("access.share", {
        resource: { type: "record", id },
        subject: { kind: "person", id: m.personId },
        level: "view",
        idempotencyKey: key,
      });

    await add(ROUND);
    const first = await find("p0-0@kv.test");
    const second = await find("p0-1@kv.test");
    const third = await find("p0-2@kv.test");
    await share(first, "kvc-share-1"); // a write publishes the view as it stands

    // 1. a sync adds records: the first list builds the view in slices, a member asking in the middle is served the whole view, and a share written in the middle is there afterwards
    await add(ROUND);
    let sliced = shareKept.sliced;
    const ownerAsk = contacts(h.owner);
    await new Promise((r) => setTimeout(r, 20));
    const mid = contacts(m);
    await share(second, "kvc-share-2");
    const [o, midAnswer] = await Promise.all([ownerAsk, mid]);
    assert.ok(shareKept.sliced > sliced, "the list was built in slices");
    assert.equal(o.total, total, "the owner's view was whole");
    assert.ok(
      midAnswer.total === 1 || midAnswer.total === 2,
      `the member in the middle saw either side of the share, never a part of the view: ${midAnswer.total} rows`,
    );
    assert.deepEqual(
      midAnswer.rows.map((r) => r.id).filter((id) => id !== first && id !== second),
      [],
      "only what was shared with them",
    );
    const after = await contacts(m);
    assert.deepEqual(new Set(after.rows.map((r) => r.id)), new Set([first, second]), "both shares are there");
    assert.equal((await contacts(h.owner)).total, total);

    // 2. a share is the first thing to ask after records were added: it waits for the view built in slices and is made on the whole view
    await add(ROUND);
    sliced = shareKept.sliced;
    const t0 = performance.now();
    await share(third, "kvc-share-3");
    console.log(
      `MEASURE a share asked first, after ${ROUND} records were added, took ${Math.round(performance.now() - t0)} ms`,
    );
    assert.ok(shareKept.sliced > sliced, "the share waited for a view built in slices");
    const all = await contacts(m);
    assert.deepEqual(new Set(all.rows.map((r) => r.id)), new Set([first, second, third]), "the share is there");
    assert.equal((await contacts(h.owner)).total, total);

    // 3. the access state moves in place while the rows are being worked out (a revoke adopted into the kept view): what was worked out is old and is thrown away, the build is done again
    await add(ROUND);
    const discarded = shareKept.discarded;
    sliceHook.run = async (store) => {
      asKeptWriter(() => store.bump());
    };
    await contacts(h.owner);
    assert.equal(sliceHook.run, null, "the view moved in the middle of a build");
    assert.equal(shareKept.discarded, discarded + 1, "the build that was overtaken was thrown away");
    assert.equal((await contacts(h.owner)).total, total, "the owner's view is whole");

    // 4. a label raised over the member's clearance while the view is being built, with a second reader asking: the member's next list does not show the record
    await add(ROUND);
    sliceHook.run = async () => {
      await h.owner.call("access.labels.set", { resource: { type: "record", id: first }, label: "restricted" });
      await new Promise((r) => setTimeout(r, 300));
    };
    const building = contacts(h.owner);
    await new Promise((r) => setTimeout(r, 20));
    const alongside = contacts(m);
    await Promise.all([building, alongside]);
    assert.equal(sliceHook.run, null, "the label was raised in the middle of a build");
    const revoked = await contacts(m);
    assert.deepEqual(
      new Set(revoked.rows.map((r) => r.id)),
      new Set([second, third]),
      "the record that was restricted mid-build is not in the member's list",
    );
    assert.equal((await contacts(h.owner)).total, total, "the owner's view is whole");
  },
);
