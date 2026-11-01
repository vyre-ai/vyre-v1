// The Terminal tab of the chat pane (rc.8): which session it starts on.
import test from "node:test";
import assert from "node:assert/strict";
import { openHere, startSession } from "./TerminalPaneTab.tsx";

const row = (o: Record<string, unknown>) => ({ terminalId: "trm_1", host: "device", state: "idle", lastActiveAt: 1, ...o }) as never;

test("the pane starts on the newest live session of the chat's agent computer, else this computer; an exited one is never picked", () => {
  const rows = [row({ terminalId: "a", host: "device", lastActiveAt: 5 }), row({ terminalId: "b", host: "agent_computer", computerId: "cmp_1", lastActiveAt: 3 }), row({ terminalId: "c", host: "agent_computer", computerId: "cmp_1", lastActiveAt: 4 }), row({ terminalId: "d", host: "agent_computer", computerId: "cmp_1", lastActiveAt: 9, state: "exited" })];
  assert.equal(startSession(rows, "cmp_1")?.terminalId, "c");
  assert.equal(startSession(rows, undefined)?.terminalId, "a");
  assert.equal(startSession(rows, "cmp_2")?.terminalId, "a", "no session there: this computer");
  assert.equal(startSession([row({ state: "exited" })], undefined), undefined);
});

const rig = (devices: unknown[], extra: Record<string, unknown> = {}, team = false) => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "devices.mine") return { devices };
    if (cap === "computers.list") return { computers: [] };
    if (cap === "terminal.open" || cap === "terminal.open_server") return { terminal: { terminalId: "trm_new" } };
    return extra[cap] ?? {};
  };
  return { calls, d: { call, newKey: () => "k", team, clock: () => ({ now: 10, offsetMin: 0 }), ...(extra["agent"] ? { agent: extra["agent"] as never } : {}) } };
};

test("Open terminal in Personal names this computer: a terminal on a computer must say which, the pane never sends a bare device call", async () => {
  const r = rig([{ id: "dev_mac", name: "Mac", class: "desktop", current: true, lastSeenAt: 1 }]);
  assert.deepEqual(await openHere(r.d), { s: "opened", terminalId: "trm_new" });
  assert.deepEqual(r.calls.find((c) => c.cap === "terminal.open")?.input, { host: "device", deviceId: "dev_mac", idempotencyKey: "k" });
});

test("a chat with an agent computer opens on it", async () => {
  const r = rig([], { agent: { agentId: "agt_1", name: "Desk", computerId: "cmt_1" } }, true);
  await openHere(r.d);
  assert.deepEqual(r.calls.find((c) => c.cap === "terminal.open")?.input, { host: "agent_computer", agentId: "agt_1", computerId: "cmt_1", idempotencyKey: "k" });
});

test("where this is not a computer (the web, a phone) the person chooses among the hosts that are online (one computer of theirs is simply used), or is told there is none", async () => {
  const web = rig([{ id: "dev_phone", name: "Phone", class: "mobile", current: true, lastSeenAt: 1 }, { id: "dev_home", name: "Home Mac", class: "desktop", lastSeenAt: 9 }, { id: "dev_work", name: "Work Mac", class: "desktop", lastSeenAt: 9 }], {}, true);
  const choose = await openHere(web.d);
  assert.equal(choose.s, "choose");
  assert.deepEqual(choose.s === "choose" ? choose.hosts.map((h) => h.label) : [], ["Home Mac", "Work Mac", "Space server"]);
  assert.ok(!web.calls.some((c) => c.cap === "terminal.open"), "nothing is opened until they choose");
  const nothing = rig([], {}, false);
  assert.deepEqual(await openHere(nothing.d), { s: "none" });
});

test("when this is not a computer and they have only one other, it is used rather than asking", async () => {
  const r = rig([{ id: "dev_phone", name: "Phone", class: "mobile", current: true, lastSeenAt: 1 }, { id: "dev_home", name: "Home Mac", class: "desktop", lastSeenAt: 9 }]);
  assert.deepEqual(await openHere(r.d), { s: "opened", terminalId: "trm_new" });
  assert.equal(r.calls.find((c) => c.cap === "terminal.open")?.input["deviceId"], "dev_home");
});
