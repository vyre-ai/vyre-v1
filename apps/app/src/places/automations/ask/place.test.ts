// Placed steps are new connector requests. A webhook is added once. Secrets stay off the definition.
import test from "node:test";
import assert from "node:assert/strict";
import { placeSteps, placeWebhook, showTry, triggersFrom } from "./place.ts";
import type { AccountOption } from "../connect/accounts.ts";
import type { Definition } from "../canvas/model.ts";

const account: AccountOption = { id: "con_1", app: "notes", title: "Notes", state: "ready" };
const secret = "sk-live-do-not-keep";

function tiny(): Definition {
  return { triggers: [{ key: "manual" }], start: ["s"], nodes: [{ id: "s", key: "stop", input: {} }] };
}

test("showTry is true only for a read", () => {
  assert.equal(showTry("read"), true);
  assert.equal(showTry("outward"), false);
  assert.equal(showTry(null), false);
  assert.equal(showTry(undefined), false);
});

test("triggersFrom returns one webhook offer and does not copy a path or a secret", () => {
  const offers = triggersFrom({
    url: "https://hooks.example/in",
    secret,
    setup: {
      path: "/hooks",
      url: `https://hooks.example/${secret}`,
      triggers: [
        null,
        { key: "schedule", check: "later", path: "/cron", url: "https://hooks.example/cron" },
        {
          key: "incoming",
          check: "hold",
          path: `/hooks/${secret}`,
          method: "POST",
          url: "https://hooks.example/in",
          secret,
        },
        { key: "again", check: "dry_run", path: "/again", url: "https://hooks.example/again" },
      ],
    },
  });
  assert.deepEqual(offers, [{
    key: "webhook",
    check: "hold",
    say: "A webhook stays off until you run it.",
  }]);
  const blob = JSON.stringify(offers);
  assert.equal(blob.includes("path"), false);
  assert.equal(blob.includes("https://"), false);
  assert.equal(blob.includes("sk-"), false);
});

test("a payload with no setup returns no trigger offer", () => {
  assert.deepEqual(triggersFrom({ triggers: [{ key: "webhook", check: "hold", path: "/hooks", url: "https://hooks.example/in" }] }), []);
  assert.deepEqual(triggersFrom({}), []);
  assert.deepEqual(triggersFrom(null), []);
  assert.deepEqual(triggersFrom(undefined), []);
  assert.deepEqual(triggersFrom("setup"), []);
  assert.deepEqual(triggersFrom({ setup: null }), []);
  assert.deepEqual(triggersFrom({ setup: { triggers: "webhook" } }), []);
  assert.deepEqual(triggersFrom({ setup: { triggers: [{ key: "webhook", check: "run", path: "/hooks" }] } }), []);
  assert.deepEqual(triggersFrom({ setup: { triggers: [null, "webhook", { check: "hold" }, { key: 1, check: "dry_run" }] } }), []);
});

test("placeSteps adds two connector steps and leaves the selected step", () => {
  const start = tiny();
  const placed = placeSteps(start, [{ action: "listNotes" }, { action: "createNote" }], account, "s");
  assert.ok("def" in placed);
  if (!("def" in placed)) return;
  assert.equal(start.nodes.length, 1);
  assert.equal(start.nodes[0]!.input && Object.keys(start.nodes[0]!.input).length, 0);
  assert.equal(placed.nodeIds.length, 2);
  assert.notEqual(placed.nodeIds[0], placed.nodeIds[1]);
  const stop = placed.def.nodes.find((node) => node.id === "s");
  assert.equal(stop?.key, "stop");
  assert.deepEqual(stop?.input, {});
  const first = placed.def.nodes.find((node) => node.id === placed.nodeIds[0]);
  const second = placed.def.nodes.find((node) => node.id === placed.nodeIds[1]);
  assert.equal(first?.key, "connector_request");
  assert.equal(second?.key, "connector_request");
  assert.deepEqual(first?.input, { connectionId: "con_1", action: "listNotes" });
  assert.deepEqual(second?.input, { connectionId: "con_1", action: "createNote" });
  assert.equal(placed.def.nodes.filter((node) => node.key === "connector_request").length, 2);
});

test("a second call adds a new connector step instead of rewriting the first", () => {
  const first = placeSteps(tiny(), [{ action: "listNotes" }, { action: "createNote" }], account, "s");
  assert.ok("def" in first);
  if (!("def" in first)) return;
  const again = placeSteps(first.def, [{ action: "findNote" }], account, first.nodeIds[0] ?? null);
  assert.ok("def" in again);
  if (!("def" in again)) return;
  assert.equal(again.nodeIds.length, 1);
  assert.equal(again.nodeIds.includes(first.nodeIds[0]!), false);
  assert.equal(again.nodeIds.includes(first.nodeIds[1]!), false);
  assert.equal(again.def.nodes.length, first.def.nodes.length + 1);
  const kept = again.def.nodes.find((node) => node.id === first.nodeIds[0]);
  assert.equal(kept?.key, "connector_request");
  assert.deepEqual(kept?.input, { connectionId: "con_1", action: "listNotes" });
  const added = again.def.nodes.find((node) => node.id === again.nodeIds[0]);
  assert.equal(added?.key, "connector_request");
  assert.deepEqual(added?.input, { connectionId: "con_1", action: "findNote" });
});

test("a mail account writes mailboxId and does not write action", () => {
  const mail: AccountOption = { id: "mbx_1", app: "mail", title: "Inbox", state: "ready" };
  const placed = placeSteps(tiny(), [{ action: "listNotes" }], mail, "s");
  assert.ok("def" in placed);
  if (!("def" in placed)) return;
  const node = placed.def.nodes.find((item) => item.id === placed.nodeIds[0]);
  assert.equal(node?.key, "connector_request");
  assert.deepEqual(node?.input, { mailboxId: "mbx_1" });
});

test("an action named api_key is dropped", () => {
  const placed = placeSteps(tiny(), [{ action: "listNotes" }, { action: "api_key" }, { action: "" }], account, "s");
  assert.ok("def" in placed);
  if (!("def" in placed)) return;
  assert.deepEqual(placed.nodeIds, [placed.def.nodes.find((node) => node.key === "connector_request")?.id]);
  const node = placed.def.nodes.find((item) => item.id === placed.nodeIds[0]);
  assert.deepEqual(node?.input, { connectionId: "con_1", action: "listNotes" });
  assert.equal(JSON.stringify(placed.def).includes("api_key"), false);
  assert.deepEqual(placeSteps(tiny(), [{ action: "" }, { action: "api_key" }], account, null), { error: "There is no step to add." });
});

test("empty items returns the error sentence", () => {
  assert.deepEqual(placeSteps(tiny(), [], account, "s"), { error: "There is no step to add." });
});

test("an empty connection is refused before a step is added", () => {
  const missing: AccountOption = { id: "", app: "notes", title: "Notes", state: "ready" };
  assert.deepEqual(placeSteps(tiny(), [{ action: "listNotes" }], missing, "s"), { error: "Link a connection before adding this step." });
});

test("placeWebhook adds one webhook and a second call does not", () => {
  const start = tiny();
  const once = placeWebhook(start);
  assert.notEqual(once, start);
  assert.deepEqual(start.triggers, [{ key: "manual" }]);
  assert.deepEqual(once.triggers, [{ key: "manual" }, { key: "webhook" }]);
  const twice = placeWebhook(once);
  assert.notEqual(twice, once);
  assert.deepEqual(twice.triggers, [{ key: "manual" }, { key: "webhook" }]);
  assert.equal(twice.triggers.filter((trigger) => trigger.key === "webhook").length, 1);
  assert.deepEqual(twice.triggers[1], { key: "webhook" });
  assert.equal(JSON.stringify(twice).includes("https://"), false);
});

test("a definition after placeSteps does not contain a secret from the account title", () => {
  const leak: AccountOption = { id: "con_1", app: "notes", title: `Bearer ${secret}`, state: "ready" };
  const placed = placeSteps(tiny(), [{ action: "listNotes" }, { action: "createNote" }], leak, "s");
  assert.ok("def" in placed);
  if (!("def" in placed)) return;
  const blob = JSON.stringify(placed.def);
  assert.equal(blob.includes("sk-"), false);
  assert.equal(blob.includes("Bearer"), false);
  assert.equal((placed.def.nodes.find((node) => node.id === placed.nodeIds[0])?.input as { connectionId?: string }).connectionId, "con_1");
});
