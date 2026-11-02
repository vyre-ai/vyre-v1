// The line under an Automation's name, and when a refusal offers Connect.
import test from "node:test";
import assert from "node:assert/strict";
import { needsConnecting, sendsFromLine } from "./senders.ts";

const box = { id: "mbx_a", channel: "email", address: "hello@firm.com", usable: true } as const;

test("the line names what the Automation sends from, and says so when it cannot", () => {
  assert.equal(sendsFromLine([]), null);
  assert.deepEqual(sendsFromLine([box]), { text: "Sends from hello@firm.com", ok: true });
  assert.equal(sendsFromLine([box, { ...box, id: "num_a", channel: "text", address: "+14155550100" }])?.text, "Sends from hello@firm.com and +14155550100");
  assert.deepEqual(sendsFromLine([{ ...box, usable: false, why: "Paused. Resume it in Console, Comms." }]), { text: "hello@firm.com cannot send. Paused. Resume it in Console, Comms.", ok: false });
});

test("a refusal that a connection fixes offers Connect", () => {
  assert.equal(needsConnecting("No mailbox is connected yet. Connect one in Console, Comms, then turn this on."), true);
  assert.equal(needsConnecting("Fix the problem before turning this on."), false);
});
