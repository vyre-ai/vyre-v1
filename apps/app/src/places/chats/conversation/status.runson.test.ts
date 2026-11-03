// The chat's lines about where it runs (lane l-runson): a chat waiting for the person's computer, its one action, the activity line while a turn waits, and where a turn ran in its details.
import test from "node:test";
import assert from "node:assert/strict";
import { ranOnText, statusView } from "./status.ts";
import { stepLabel } from "./activity.ts";

const block = (data: Record<string, unknown>) => ({ id: "blk_1", type: "turn_status", v: 1, data }) as never;

test("a chat waiting for the person's computer is a quiet line with Run it on the server instead; a turn that failed for it offers the same", () => {
  assert.deepEqual(statusView(block({ state: "device_wait", text: "Your computer is off. This chat runs when it is back." })), { kind: "wait", id: "blk_1", text: "Your computer is off. This chat runs when it is back.", action: { key: "run_on_server", label: "Run it on the server instead" } });
  assert.deepEqual(statusView(block({ state: "device_wait", text: "Your computer went to sleep. This chat waits for it." })).kind, "wait");
  const failed = statusView(block({ state: "failed", code: "engine.device_off", turnId: "t1" }));
  assert.equal(failed.kind, "error");
  assert.deepEqual((failed as { block: { data: { next: unknown } } }).block.data.next, [{ key: "run_on_server", label: "Run it on the server instead" }]);
  assert.deepEqual(statusView(block({ state: "note", text: "Your computer went to sleep; continuing on the Northwind server" })), { kind: "note", id: "blk_1", text: "Your computer went to sleep; continuing on the Northwind server" });
});

test("the live line of a turn waiting for its computer, and where a turn ran", () => {
  assert.equal(stepLabel("device_wait"), "Waiting for your computer");
  assert.equal(ranOnText([{ kind: "computer", name: "Olivia's Mac" }]), "Olivia's Mac");
  assert.equal(ranOnText([{ kind: "computer", name: "Olivia's Mac" }, { kind: "space", name: "the Northwind server" }]), "Olivia's Mac, then the Northwind server");
  assert.equal(ranOnText([{ kind: "space", name: "the Northwind server" }]), "The Northwind server");
});
