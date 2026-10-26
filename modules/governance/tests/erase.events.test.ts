// Erase reaches the event log (P-CC_41): after the erasers, governance asks the log to tombstone the payloads of everything about the erased items and of events that name the person's own text, keeps the
// seqs it erased as a tombstone (never text), and a restore replays those seqs. The log is a scripted port here; the real compaction is tested in kernel/tests/compact.test.ts.
// @reads /modules/governance/handlers/erase.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as g from "../handlers/index.ts";
import { PAT, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const EMAIL = "pat@client.example";

function pat(h: Harness): void {
  h.addRecord(PAT);
  h.world.sureByTerm.set(EMAIL, { type: "contact", id: PAT });
  h.addFile("fil_pat00001", { name: "Pat Lee intake.docx" });
  h.world.searchHits.set(EMAIL, [{ id: "fil_pat00001", kind: "file", title: "Pat Lee intake.docx" }]);
}

function port(over: { erased?: number[] } = {}) {
  const calls: Array<{ op: string; arg: unknown }> = [];
  return {
    calls,
    p: {
      async compact(subject: unknown) { calls.push({ op: "compact", arg: subject }); return { erased: over.erased ?? [4, 5, 9], already: 0 }; },
      async compactSeqs(seqs: readonly number[]) { calls.push({ op: "compactSeqs", arg: [...seqs] }); return { erased: [...seqs], already: 0 }; },
    },
  };
}
const find = (h: Harness) => g.eraseFind(h.ctx, { subject: { email: EMAIL, name: "Pat Lee" } });
const apply = (h: Harness, findingId: string, include: string[]) => g.eraseApply(h.ctx, { findingId, include, idempotencyKey: `k-${findingId}` } as Parameters<typeof g.eraseApply>[1]);

test("erase compacts the log once, with the erased ids and the person's own text read before the records went, and keeps only the seqs", async () => {
  const h = harness();
  pat(h);
  const x = port();
  g.setEventsCompact(x.p);
  try {
    const f = (await find(h)) as Json;
    await apply(h, String(f["findingId"]), ["records", "files"]);
    assert.equal(x.calls.filter((c) => c.op === "compact").length, 1);
    const subject = x.calls[0]!.arg as { entities: Array<{ id: string }>; identifiers: string[] };
    assert.ok(subject.entities.some((e) => e.id === PAT), "the contact record");
    assert.ok(subject.entities.some((e) => e.id === "fil_pat00001"), "the file");
    assert.ok(subject.identifiers.includes("Pat Lee"), "the name, read from the record before it was deleted");
    const row = h.rows(`SELECT * FROM governance_tombstone WHERE kind = 'events'`);
    assert.equal(row.length, 1);
    assert.equal(row[0]!["subjectId"], JSON.stringify([4, 5, 9]));
    assert.equal(JSON.stringify(h.rows(`SELECT * FROM governance_tombstone`)).includes("Pat Lee"), false, "the tombstones hold ids and seqs, never the name");
  } finally { g.setEventsCompact(null); }
});

test("a restore replays the seqs: the older events.db comes back with its payloads and they leave again", async () => {
  const h = harness();
  pat(h);
  const x = port();
  g.setEventsCompact(x.p);
  try {
    const f = (await find(h)) as Json;
    await apply(h, String(f["findingId"]), ["records", "files"]);
    x.calls.length = 0;
    await g.tombstonesReapply(h.ctx);
    assert.deepEqual(x.calls, [{ op: "compactSeqs", arg: [4, 5, 9] }]);
  } finally { g.setEventsCompact(null); }
});

test("with no event log bound erase works as before, and when the log erased nothing no tombstone is written", async () => {
  const h = harness();
  pat(h);
  const f = (await find(h)) as Json;
  await apply(h, String(f["findingId"]), ["records", "files"]);
  assert.equal(h.rows(`SELECT * FROM governance_tombstone WHERE kind = 'events'`).length, 0);
  const h2 = harness();
  pat(h2);
  const x = port({ erased: [] });
  g.setEventsCompact(x.p);
  try {
    const f2 = (await find(h2)) as Json;
    await apply(h2, String(f2["findingId"]), ["records", "files"]);
    assert.equal(h2.rows(`SELECT * FROM governance_tombstone WHERE kind = 'events'`).length, 0);
  } finally { g.setEventsCompact(null); }
});
