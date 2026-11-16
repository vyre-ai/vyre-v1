// @tsx
// Send for signature from the command palette: the one request, taken once, and the PDFs it offers.
import test from "node:test";
import assert from "node:assert/strict";
import { onSignRequest, pdfsOf, requestSignPicker, takeSignRequest } from "./pick.ts";
import { gateActions } from "../../../shell/cmdk/gate.ts";

test("a request waits until the host takes it, once", () => {
  assert.equal(takeSignRequest(), false);
  let heard = 0;
  const off = onSignRequest(() => heard++);
  requestSignPicker();
  assert.equal(heard, 1);
  assert.equal(takeSignRequest(), true);
  assert.equal(takeSignRequest(), false);
  off();
  requestSignPicker();
  assert.equal(heard, 1, "a host that went away hears nothing");
  assert.equal(takeSignRequest(), true, "the request waits for the next one");
});

const F = [
  { fileId: "f1", name: "Northwind NDA.pdf", mime: "application/pdf" },
  { fileId: "f2", name: "notes.md", mime: "text/markdown" },
  { fileId: "f3", name: "Scan", mime: "application/pdf" },
  { fileId: "f4", name: "Services agreement.PDF", mime: "" },
];

test("only PDFs are offered, by name or by type, narrowed by what was typed", () => {
  assert.deepEqual(
    pdfsOf(F, "").map((f) => f.fileId),
    ["f1", "f3", "f4"],
  );
  assert.deepEqual(
    pdfsOf(F, "nda").map((f) => f.fileId),
    ["f1"],
  );
  assert.deepEqual(pdfsOf(F, "zzz"), []);
});

test("the palette offers Send a file for signature only to a person who may send", () => {
  const state = { away: false, offline: false };
  const has = (signing: boolean): boolean =>
    gateActions(state, true, false, signing).some(
      (a) => a.key === "sign.send" && a.title === "Send a file for signature",
    );
  assert.equal(has(true), true);
  assert.equal(has(false), false, "absent, not disabled");
});
