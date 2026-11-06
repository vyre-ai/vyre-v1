// The record menu: what shows for one record, a pick and the whole table, and that each item reaches its one call.
import test from "node:test";
import assert from "node:assert/strict";
import { recordMenu } from "./record.ts";
import type { RecordDo, RecordFacts } from "./record.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const items = (es: readonly MenuEntry[]): MenuItem[] => es.filter((e): e is MenuItem => !("separator" in e) && !("head" in e));
function run(f: Partial<RecordFacts>, only: readonly (keyof RecordDo)[] = ["star", "share", "copyLink"]): { es: MenuEntry[]; did: string[] } {
  const did: string[] = [];
  const d: RecordDo = { open: () => void did.push("open"), exportCsv: () => void did.push("export"), remove: () => void did.push("remove") };
  if (only.includes("star")) d.star = (on) => void did.push(`star:${on}`);
  if (only.includes("share")) d.share = () => void did.push("share");
  if (only.includes("copyLink")) d.copyLink = () => void did.push("link");
  const facts: RecordFacts = { n: 1, every: false, single: true, starred: false, canExport: true, ...f };
  return { es: recordMenu(facts, d), did };
}

test("one record: Open, Star, Share, Copy Link, Delete, each reaching its call, and only Enter and S shown as keys", () => {
  const { es, did } = run({});
  const its = items(es);
  assert.deepEqual(its.map((x) => x.label), ["Open", "Star", "Share…", "Copy Link", "Delete"]);
  assert.deepEqual(its.map((x) => x.hint), ["Enter", "S", undefined, undefined, undefined]);
  for (const x of its) x.onSelect?.();
  assert.deepEqual(did, ["open", "star:true", "share", "link", "remove"]);
  assert.equal(its.find((x) => x.label === "Delete")?.danger, true);
});

test("a starred record says Remove Star and turns the star off", () => {
  const { es, did } = run({ starred: true });
  const star = items(es).find((x) => x.label === "Remove Star");
  assert.ok(star);
  star.onSelect?.();
  assert.deepEqual(did, ["star:false"]);
});

test("a pick of several offers only Delete with its count; the whole table adds Export; no Share door leaves no Share", () => {
  assert.deepEqual(items(run({ n: 3, single: false }).es).map((x) => x.label), ["Delete 3 records"]);
  assert.deepEqual(items(run({ n: 1200, every: true, single: false }).es).map((x) => x.label), ["Export as CSV", "Delete 1,200 records"]);
  assert.deepEqual(items(run({ n: 1200, every: true, single: false, canExport: false }).es).map((x) => x.label), ["Delete 1,200 records"]);
  assert.deepEqual(items(run({}, ["star"]).es).map((x) => x.label), ["Open", "Star", "Delete"]);
});
