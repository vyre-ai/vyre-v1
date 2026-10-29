// Draft actions become step proposals. A copied value and a url never leave the result.
import test from "node:test";
import assert from "node:assert/strict";
import { actionsFrom, proposalsFrom } from "./proposals.ts";

const secret = "sk-live-do-not-keep";
const url = "https://secret.example/notes";

test("a draft result keeps two actions and drops a copied value and a url", () => {
  const actions = actionsFrom({
    url,
    fields: [{ name: "apiKey", value: secret }],
    actions: [
      {
        key: "listNotes",
        effect: "read",
        method: "GET",
        path: "/notes",
        url,
        value: secret,
        headers: { Authorization: secret },
        examples: [{ note: secret }],
      },
      {
        key: "createNote",
        effect: "outward",
        method: "POST",
        path: "/notes",
        url,
        value: secret,
        headers: { Authorization: secret },
        examples: [secret],
      },
    ],
  });
  assert.deepEqual(actions, [
    { key: "listNotes", effect: "read", method: "GET", path: "/notes" },
    { key: "createNote", effect: "outward", method: "POST", path: "/notes" },
  ]);
  const blob = JSON.stringify(actions);
  assert.equal(blob.includes("sk-live"), false);
  assert.equal(blob.includes(url), false);
});

test("proposals map a read to dry_run and an outward call to hold", () => {
  const proposals = proposalsFrom([
    { key: "listNotes", effect: "read", method: "GET", path: "/notes/sk-live-do-not-keep" },
    { key: "createNote", effect: "outward", method: "POST", path: url },
  ]);
  assert.deepEqual(proposals, [
    {
      action: "listNotes",
      effect: "read",
      check: "dry_run",
      title: "listNotes",
      say: "A read can be tried with the saved connection.",
    },
    {
      action: "createNote",
      effect: "outward",
      check: "hold",
      title: "createNote",
      say: "An outward call waits until you run it.",
    },
  ]);
  const blob = JSON.stringify(proposals);
  assert.equal(blob.includes("sk-live"), false);
  assert.equal(blob.includes(url), false);
  assert.equal(blob.includes("GET"), false);
  assert.equal(blob.includes("POST"), false);
});

test("a bad payload returns no actions", () => {
  assert.deepEqual(actionsFrom(null), []);
  assert.deepEqual(actionsFrom(undefined), []);
  assert.deepEqual(actionsFrom("actions"), []);
  assert.deepEqual(actionsFrom(1), []);
  assert.deepEqual(actionsFrom([]), []);
  assert.deepEqual(actionsFrom({}), []);
  assert.deepEqual(actionsFrom({ actions: null }), []);
  assert.deepEqual(actionsFrom({ actions: {} }), []);
});

test("an action missing effect is skipped", () => {
  const actions = actionsFrom({
    actions: [
      { key: "listNotes", method: "GET", path: "/notes", value: secret },
      { key: "createNote", effect: "outward", method: "POST" },
      { effect: "read", method: "GET" },
      { key: "", effect: "read" },
      { key: "nope", effect: "write" },
      null,
      "listNotes",
    ],
  });
  assert.deepEqual(actions, [{ key: "createNote", effect: "outward", method: "POST" }]);
  assert.equal(JSON.stringify(actions).includes("sk-live"), false);
});
