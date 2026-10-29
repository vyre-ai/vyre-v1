// A saved connection can try a read. An outward call is not given a capability. The line drops secrets.
import test from "node:test";
import assert from "node:assert/strict";
import { publicResult, readOffer } from "./read.ts";

const secret = "sk-live-do-not-keep";

test("a catalog read uses steps.test and drops a pasted key", () => {
  const offer = readOffer({ stepKey: "google.gmail.list_messages", connectionId: "con_g", input: { q: "newer", apiKey: secret } });
  assert.equal(offer.kind, "catalog");
  if (offer.kind !== "catalog") return;
  assert.equal(offer.cap, "steps.test");
  assert.equal(offer.input.input.connectionId, "con_g");
  assert.equal(offer.input.input.q, "newer");
  assert.equal(JSON.stringify(offer).includes(secret), false);
  assert.equal("apiKey" in offer.input.input, false);
});

test("a send is held and names no capability", () => {
  const offer = readOffer({ stepKey: "google.gmail.send_message", connectionId: "con_g" });
  assert.equal(offer.kind, "hold");
  assert.match(offer.say, /waits until you run it/);
  const blob = JSON.stringify(offer);
  assert.equal(blob.includes("steps.test"), false);
  assert.equal(blob.includes("connectors.run"), false);
});

test("a connector read is a dry-run preview", () => {
  const offer = readOffer({
    stepKey: "connector_request",
    effect: "read",
    connectionId: "con_s",
    connector: "stripe",
    action: "listNotes",
    input: { limit: 2, authorization: "Bearer abcdefghijklmnop" },
  });
  assert.equal(offer.kind, "preview");
  if (offer.kind !== "preview") return;
  assert.equal(offer.cap, "connectors.run");
  assert.equal(offer.input.dryRun, true);
  assert.equal(offer.input.connectionId, "con_s");
  assert.equal("authorization" in offer.input.input, false);
});

test("a connector write is held", () => {
  const offer = readOffer({ stepKey: "connector_request", effect: "outward", connectionId: "con_s", connector: "stripe", action: "createNote" });
  assert.equal(offer.kind, "hold");
  assert.match(offer.say, /waits until you run it/);
});

test("a connector request with no effect is held", () => {
  const offer = readOffer({ stepKey: "connector_request", connectionId: "con_s", connector: "stripe", action: "listNotes" });
  assert.equal(offer.kind, "hold");
  assert.match(offer.say, /waits until you run it/);
});

test("an unknown step is not a read", () => {
  const offer = readOffer({ stepKey: "teleport", connectionId: "con_g" });
  assert.equal(offer.kind, "hold");
  assert.match(offer.say, /not a read/);
});

test("a read without a connection is not called", () => {
  const offer = readOffer({ stepKey: "google.gmail.list_messages" });
  assert.equal(offer.kind, "hold");
  assert.match(offer.say, /needs the saved connection/);
});

test("the result line redacts a bearer token", () => {
  const line = publicResult({ output: { note: "Authorization: Bearer abcdefghijklmnop" } });
  assert.match(line, /\[redacted\]/);
  assert.equal(line.includes("abcdefghijklmnop"), false);
});
