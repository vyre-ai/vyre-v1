// A Space of 50,000 records: the first list after the view went stale is built in slices with a turn for other requests between, so no request waits more than 200 ms for it, and a person who asks in the middle of
// the build is never served half a view or an old one. Real server-role daemon (the loop gap is measured in the daemon's own process).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { shareKept, sliceHook } from "../modules/access/handlers/share.ts";
import { asKeptWriter } from "../modules/access/projections.ts";

let h: Hour;
let m: Person;
const TOTAL = 50_000;
before(async () => {
  h = await bootHour("kvchunk");
});
after(async () => {
  await h?.stop();
});

/** The longest time the event loop was held while `f` ran. */
async function longestBlock<T>(f: () => Promise<T>): Promise<{ value: T; worst: number }> {
  let last = performance.now();
  let worst = 0;
  const t = setInterval(() => {
    const n = performance.now();
    worst = Math.max(worst, n - last);
    last = n;
  }, 2);
  try {
    const value = await f();
    return { value, worst };
  } finally {
    clearInterval(t);
  }
}

const contacts = async (p: { call(cap: string, input?: Record<string, unknown>): Promise<any> }) =>
  (await p.call("access.lists", { type: "record", limit: 5 })) as {
    rows: Array<{ id: string }>;
    counts: Record<string, number>;
    total: number;
  };

test(
  "a view that many records were added to is built in slices, and a person asking in the middle is served the whole view",
  { timeout: 1_500_000 },
  async () => {
    const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const inv = await h.owner.call("members.invites.create", {
      role: roles.find((r) => r.name === "Member")!.id,
      email: "mia@firm.test",
    });
    m = h.person("Mia Moss", "mia", "mia@firm.test", "mia horse battery staple 9");
    await join(h, m, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });

    let batch = 0;
    const add = async (n: number): Promise<void> => {
      for (let b = 0; b < n / 500; b++, batch++)
        await h.owner.call("records.bulk_upsert", {
          type: "contact",
          match: ["email"],
          createOnly: true,
          idempotencyKey: `kvc-${batch}`,
          rows: Array.from({ length: 500 }, (_, i) => ({
            name: `Person ${batch}-${i}`,
            email: `p${batch}-${i}@kv.test`,
          })),
        });
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

    await add(500);
    const first = await find("p0-0@kv.test");
    const second = await find("p0-1@kv.test");
    await share(first, "kvc-share-1"); // a write publishes the view as it stands: 500 records
    await add(TOTAL - 500); // and then a sync adds the rest: the next reader has 49,500 resources to work out

    const sliced0 = shareKept.sliced;
    const cold = await longestBlock(() => contacts(h.owner));
    assert.ok(shareKept.sliced > sliced0, "the first list was built in slices");
    assert.equal(cold.value.total, TOTAL, `the owner sees all of their records ${JSON.stringify(cold.value.counts)}`);
    console.log(`MEASURE list after ${TOTAL - 500} records were added: worst block ${Math.round(cold.worst)} ms`);
    assert.ok(cold.worst < 200, `the loop was never held for 200 ms (longest ${Math.round(cold.worst)} ms)`);

    // more records arrive, and a person asks in the middle of the build
    await add(5000);
    const sliced1 = shareKept.sliced;
    const ownerAsk = contacts(h.owner);
    await new Promise((r) => setTimeout(r, 30));
    const mid = contacts(m);
    await share(second, "kvc-share-2"); // a write while the view is being built
    const [o, midAnswer] = await Promise.all([ownerAsk, mid]);
    assert.ok(shareKept.sliced > sliced1, "the second list was built in slices too");
    assert.equal(o.total, TOTAL + 5000, "the owner's view was whole");
    assert.ok(
      midAnswer.total === 1 || midAnswer.total === 2,
      `the member in the middle saw either side of the share, never a part of the view: ${midAnswer.total} rows`,
    );
    assert.deepEqual(
      midAnswer.rows.map((r) => r.id).filter((id) => id !== first && id !== second),
      [],
      "only what was shared with them",
    );
    // and once the share is committed, the next read has both
    const after = await contacts(m);
    assert.equal(after.total, 2, "the member sees both records shared with them");
    assert.deepEqual(new Set(after.rows.map((r) => r.id)), new Set([first, second]));
    assert.equal((await contacts(h.owner)).total, TOTAL + 5000, "the owner's view is still whole");

    // a writer that finds the view stale for the whole Space waits for it to be built in slices, makes its change on the whole view, and loses nothing: more records arrive and the share is the first thing to ask
    await add(5000);
    const third = await find("p0-2@kv.test");
    const sliced2 = shareKept.sliced;
    const written = await longestBlock(() => share(third, "kvc-share-3"));
    assert.ok(shareKept.sliced > sliced2, "the share waited for a view built in slices");
    console.log(`MEASURE share after 5,000 records were added: worst block ${Math.round(written.worst)} ms`);
    assert.ok(
      written.worst < 200,
      `the share never held the loop for 200 ms (longest ${Math.round(written.worst)} ms)`,
    );
    const all = await contacts(m);
    assert.equal(all.total, 3, "the share is there, and the two before it");
    assert.deepEqual(new Set(all.rows.map((r) => r.id)), new Set([first, second, third]));
    assert.equal((await contacts(h.owner)).total, TOTAL + 10_000, "the owner's view is whole");
    // the view access.sync keeps is folded in place while the rows are being worked out (a revoke adopted into it): what was worked out is old and is thrown away, the build is done again and nothing stale is kept
    await add(5000);
    const discarded0 = shareKept.discarded;
    sliceHook.run = async (store) => {
      asKeptWriter(() => store.bump());
    };
    await contacts(h.owner);
    assert.equal(sliceHook.run, null, "the view moved in the middle of a build");
    assert.equal(shareKept.discarded, discarded0 + 1, "the build that was overtaken was thrown away");
    assert.equal((await contacts(h.owner)).total, TOTAL + 15_000, "the owner's view is whole");

    // a revoke that lands while the view is being built is never lost: a label raised over the member's clearance, 30 ms into a build of 30,000 new records, and the member's next list does not show the record
    await add(30_000);
    const sliced3 = shareKept.sliced;
    // the label is raised between two slices, after the rows of the early records were worked out as they stood (a revoke folded into the view mid-build)
    sliceHook.run = async () => {
      await h.owner.call("access.labels.set", { resource: { type: "record", id: first }, label: "restricted" });
      await new Promise((r) => setTimeout(r, 400));
    };
    const building = contacts(h.owner);
    await new Promise((r) => setTimeout(r, 30));
    // a second reader asks (and ensures the same kept state) while the build runs
    const alongside = contacts(m);
    await Promise.all([building, alongside]);
    assert.equal(sliceHook.run, null, "the label was raised in the middle of a build");
    assert.ok(shareKept.sliced > sliced3, "this round was built in slices too");
    const revoked = await contacts(m);
    assert.deepEqual(
      new Set(revoked.rows.map((r) => r.id)),
      new Set([second, third]),
      "the record that was restricted mid-build is not in the member's list",
    );
    assert.equal(revoked.total, 2);
    assert.equal((await contacts(h.owner)).total, TOTAL + 15_000 + 30_000, "the owner's view is whole");
  },
);
