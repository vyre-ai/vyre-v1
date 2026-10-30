// The Phone step: the pairing link is made when the step opens and shows as a QR code with the link under it; New link makes another; a failure says so.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press } from "./test-dom.ts";
import { PairPhoneCard } from "./PairPhoneCard.tsx";
import { qrPath } from "./QrCode.tsx";
import { toMatrix } from "./qr.ts";
import type { CapCall } from "../shell/session/caps.ts";

async function open(fail = false) {
  installDom();
  let n = 0;
  const calls: string[] = [];
  const call = (async (cap: string) => { calls.push(cap); if (fail) throw new Error("no"); return { code: `CODE-000${++n}`, expiresAt: 1 }; }) as unknown as CapCall;
  const r = createRoot();
  await act(async () => { r.render(<PairPhoneCard call={call} address="https://x.vyre.run" onPaired={() => undefined} />); });
  await flush();
  return { calls, root: r.container as never };
}
const text = (n: { children?: unknown[] } | null): string => (n?.children ?? []).map((c) => (typeof c === "string" ? c : text(c as never))).join("");

test("the link is made on opening and shows as a QR code with the link text", async () => {
  const t = await open();
  assert.deepEqual(t.calls, ["identity.pair_create"]);
  assert.ok(find(t.root, "pair-qr"), "the QR code is there");
  assert.match(text(find(t.root, "pair-link")), /CODE-0001/);
});

test("New link makes another code and the QR follows it", async () => {
  const t = await open();
  await press(find(t.root, "pair-make"));
  await flush();
  assert.equal(t.calls.length, 2);
  assert.match(text(find(t.root, "pair-link")), /CODE-0002/);
});

test("a failed link says so and shows no QR code", async () => {
  const t = await open(true);
  assert.ok(find(t.root, "pair-error"));
  assert.equal(find(t.root, "pair-qr"), null);
});

test("the QR path draws every dark module once", () => {
  const m = toMatrix("hello")!;
  const dark = m.flat().filter(Boolean).length;
  const cells = (qrPath(m).match(/h(\d+)v1/g) ?? []).reduce((sum, seg) => sum + Number(seg.slice(1, -2)), 0);
  assert.equal(cells, dark);
});
