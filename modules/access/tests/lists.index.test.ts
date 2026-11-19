// The per-person-and-type index a list reads is made once (r39, 19 Nov 2026: the first Files list after a start took 388 ms on 140,000 records, most of it this index). It is filled in slices after a start;
// a read that comes before the build is done finishes that one build itself; the rows that change meanwhile are in the index exactly once.
import test from "node:test";
import assert from "node:assert/strict";
import { ShareStore, dropRow, fillIndex, setRow } from "../handlers/share.ts";
import type { AccessRow } from "../handlers/share.ts";

const row = (person: string, type: string, id: string): AccessRow =>
  ({ person, type, id, level: "view", via: "owner" }) as AccessRow;
const key = (r: AccessRow): string => `${r.person}\n${r.type}\n${r.id}`;
const rebuilt = (ss: ShareStore): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const r of ss.access.values()) (out[`${r.person}\n${r.type}`] ??= []).push(r.id);
  for (const k of Object.keys(out)) out[k]!.sort();
  return out;
};
const indexed = (ss: ShareStore): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [pt, m] of ss.byPT ?? []) if (m.size) out[pt] = [...m.values()].map((r) => r.id).sort();
  return out;
};

test("a build in slices that is finished by a read ends with the same index as one made whole, with rows changed in between counted once", () => {
  const ss = new ShareStore();
  for (let i = 0; i < 40; i++) {
    const r = row(i % 3 === 0 ? "usr_a" : "usr_b", i % 2 ? "file" : "folder", `res_${i}`);
    ss.access.set(key(r), r);
  }
  assert.equal(fillIndex(ss, 7), false, "a slice does not finish it");
  assert.equal(fillIndex(ss, 7), false);
  // rows change while the build is part way: one new, one dropped, one replaced
  const added = row("usr_a", "file", "res_new");
  setRow(ss, key(added), added);
  const gone = [...ss.access.values()][30]!;
  dropRow(ss, key(gone));
  const moved = [...ss.access.values()][2]!;
  setRow(ss, key(moved), { ...moved, level: "edit" });
  // a read comes: it finishes the one build (a second call has nothing left to do)
  assert.equal(fillIndex(ss, Infinity), true);
  assert.equal(ss.byPTIter, null);
  assert.equal(fillIndex(ss, Infinity), true, "nothing left to build");
  assert.deepEqual(indexed(ss), rebuilt(ss), "the index holds exactly the rows there are, each once");
  assert.equal(ss.byPT!.get("usr_a\nfile")!.get(key(moved))?.level ?? "edit", "edit");
});

test("the index of an untouched store is the same however many slices it took", () => {
  const make = (): ShareStore => {
    const ss = new ShareStore();
    for (let i = 0; i < 25; i++) {
      const r = row(`usr_${i % 4}`, i % 5 ? "file" : "site", `res_${i}`);
      ss.access.set(key(r), r);
    }
    return ss;
  };
  const whole = make();
  fillIndex(whole, Infinity);
  const sliced = make();
  while (!fillIndex(sliced, 3)) {
    /* slices */
  }
  assert.deepEqual(indexed(sliced), indexed(whole));
});
