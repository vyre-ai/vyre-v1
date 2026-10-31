// A sealed field on the record page: dots and Reveal, the value shown briefly with Copy and Hide, a refusal said in words, and a new value sent once over the sealed path.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { RecordPageDataProvider } from "./data.tsx";
import type { RecordPageData } from "./data.tsx";
import { SealedField, hasSealedValue, revealProblem } from "./SealedField.tsx";

const field = { key: "taxid", type: "sealed", title: "Tax ID" } as never;
const sealedRow = { id: "rec_1", type: "client", version: 3, fields: { taxid: { sealed: "taxid", ref: "vit_1", present: true } } } as never;
const emptyRow = { id: "rec_2", type: "client", version: 1, fields: { taxid: null } } as never;

function rig(row: unknown, reveal: () => Promise<unknown>): { calls: { cap: string; input: Record<string, unknown> }[]; el: ReactElement } {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const data = { call: async (cap: string, input: unknown) => { calls.push({ cap, input: input as Record<string, unknown> }); return cap === "records.reveal" ? reveal() : {}; }, nameOf: (x: string) => x } as unknown as RecordPageData;
  return { calls, el: <RecordPageDataProvider value={data}><SealedField field={field} row={row as never} type="client" /></RecordPageDataProvider> };
}
async function open(el: ReactElement): Promise<{ root: Node; stop(): Promise<void> }> {
  const r = createRoot();
  await act(async () => { r.render(el); });
  await flush();
  return { root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}

test("a sealed value is dots until Reveal; it shows with Copy, says it was logged, and Hide puts the dots back", async () => {
  const restore = installDom();
  const { calls, el } = rig(sealedRow, async () => ({ value: "123-45-6789" }));
  const o = await open(el);
  try {
    assert.ok(find(o.root, "sealed-dots-taxid"));
    assert.ok(!textOf(o.root).includes("123-45-6789"));
    await press(find(o.root, "sealed-reveal-taxid"));
    await flush();
    assert.deepEqual(calls[0], { cap: "records.reveal", input: { type: "client", recordId: "rec_1", field: "taxid" } });
    assert.equal(textOf(find(o.root, "sealed-value-taxid")), "123-45-6789");
    assert.ok(find(o.root, "sealed-copy-taxid"));
    assert.match(textOf(find(o.root, "sealed-hint-taxid")), /ten seconds.*logged/);
    await press(find(o.root, "sealed-hide-taxid"));
    assert.ok(find(o.root, "sealed-dots-taxid"));
    assert.ok(!textOf(o.root).includes("123-45-6789"));
  } finally { await o.stop(); restore(); }
});

test("a refused reveal says what to do and shows nothing", async () => {
  const restore = installDom();
  const { el } = rig(sealedRow, async () => { throw new Error("permission denied: no grant"); });
  const o = await open(el);
  try {
    await press(find(o.root, "sealed-reveal-taxid"));
    await flush();
    assert.match(textOf(find(o.root, "sealed-error-taxid")), /do not have access.*Ask an owner or admin/);
    assert.ok(find(o.root, "sealed-dots-taxid"));
  } finally { await o.stop(); restore(); }
  assert.match(revealProblem(new Error("boom")), /could not be shown/);
});

test("an empty sealed field takes a value over the sealed path, once, with the version the person saw", async () => {
  const restore = installDom();
  const { calls, el } = rig(emptyRow, async () => ({}));
  const o = await open(el);
  try {
    await press(find(o.root, "sealed-set-taxid"));
    await typeInto(find(o.root, "sealed-input-taxid"), "987-65-4321");
    await press(find(o.root, "sealed-save-taxid"));
    await flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { cap: "records.update", input: { type: "client", recordId: "rec_2", patch: { taxid: { sealed: true, value: "987-65-4321" } }, baseVersion: 1 } });
  } finally { await o.stop(); restore(); }
  assert.equal(hasSealedValue({ present: true }), true);
  assert.equal(hasSealedValue(null), false);
});
