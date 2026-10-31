// A turn pinned to one of the person's servers (node-turns.ts): which turns are routed, what a server that is off does, and how the server is remembered on the turn record.
import test from "node:test";
import assert from "node:assert/strict";
import { remoteLauncher, routed, serverFor, nodeOfTurn, setTurnNode } from "../node-turns.ts";
import type { NodeRelay } from "../node-turns.ts";
import { turnGet, turnEnqueue, turnStart } from "../handlers/extra/turns.ts";
import { harness } from "../fixtures/harness.ts";
import type { SessionSpec } from "../../../agent/src/turn-engine/types.ts";

const spec = { threadId: "thr_1", agent: { id: "agt_1" }, asker: "usr_dana", turnId: "trn_1", traceId: "a".repeat(32) } as unknown as SessionSpec;
const relay = (on: boolean, secure = true): NodeRelay => ({ connected: () => on, secure: () => secure, spawn: async () => { throw Object.assign(new Error("The server is not connected to the Space right now."), { code: "engine.server_off" }); } });

test("only a turn the person pinned to a server is routed: a connected server opens through its opener, anything else opens as before", async () => {
  const h = harness();
  const opened: string[] = [];
  const open = (label: string) => async (): Promise<never> => { opened.push(label); return {} as never; };
  const make = (decide: unknown, on = true) => routed(open("host") as never, { call: async () => { if (decide instanceof Error) throw decide; return decide; }, relay: relay(on), nodeOpener: (id) => open(`node:${id}`) as never, db: h.db });
  await make({ placement: "host", reason: "chosen_server", nodeId: "srv_home" })(spec);
  await make({ placement: "device", reason: "device" })(spec);
  await make({ placement: "host", reason: "shared_thread" })(spec);
  await make(new Error("no such agent"))(spec);
  assert.deepEqual(opened, ["node:srv_home", "host", "host", "host"]);
  assert.equal(nodeOfTurn(h.db, "trn_1"), "srv_home", "the server is kept for the turn record");
  const noRelay = routed(open("host") as never, { call: async () => ({ reason: "chosen_server", nodeId: "srv_home" }), relay: undefined, nodeOpener: open("node") as never, db: h.db });
  await noRelay(spec);
  assert.equal(opened.at(-1), "host", "a daemon with no relay runs everything as before");
});

test("a server that is off, or not connected, fails the turn with engine.server_off and its name; nothing opens", async () => {
  const h = harness();
  const opened: string[] = [];
  const open = async (): Promise<never> => { opened.push("x"); return {} as never; };
  const off = routed(open as never, { call: async () => ({ placement: "wait", reason: "server_off", nodeId: "srv_home", wakeLine: "home-box is off" }), relay: relay(true), nodeOpener: () => open as never, db: h.db });
  await assert.rejects(() => off(spec), (e) => (e as { code?: string; message?: string }).code === "engine.server_off" && (e as Error).message === "home-box is off");
  const gone = routed(open as never, { call: async () => ({ placement: "host", reason: "chosen_server", nodeId: "srv_home" }), relay: relay(false), nodeOpener: () => open as never, db: h.db });
  await assert.rejects(() => gone(spec), (e) => (e as { code?: string }).code === "engine.server_off");
  assert.deepEqual(opened, []);
  assert.equal(await serverFor(async () => ({ reason: "chosen_server" }), relay(true), spec), undefined, "a pin with no server is not a pin");
});

test("the launcher keeps the server's own refusal code, and the turn record names the server", async () => {
  await assert.rejects(() => remoteLauncher(relay(true), "srv_home").spawn({ argv: ["claude"], env: {} }), (e) => (e as { code?: string }).code === "engine.server_off");
  const h = harness();
  const { qseq } = turnEnqueue(h.ctx as never, { threadId: "thr_1", agentId: "agt_1", kind: "message", messageId: "msg_1", from: "usr_dana" });
  const { turn } = turnStart(h.ctx as never, { threadId: "thr_1", agentId: "agt_1", qseq, placement: "host", engine: "claude_code", model: "m" });
  assert.equal(turn.nodeId, undefined);
  setTurnNode(h.db, turn.turnId, "srv_home");
  assert.equal(turnGet(h.ctx as never, { turnId: turn.turnId }).what.turn.nodeId, "srv_home");
});

test("a server whose link is not private gets no key: the turn fails with engine.link_insecure before the Vault is read or any opener runs", async () => {
  const h = harness();
  const opened: string[] = [];
  const open = async (): Promise<never> => { opened.push("x"); return {} as never; };
  const insecure = routed(open as never, { call: async () => ({ placement: "host", reason: "chosen_server", nodeId: "srv_home" }), relay: relay(true, false), nodeOpener: () => open as never, db: h.db });
  await assert.rejects(() => insecure(spec), (e) => (e as { code?: string }).code === "engine.link_insecure" && /secure link/.test((e as Error).message));
  assert.deepEqual(opened, [], "no opener ran, so no account key was looked up");
  assert.equal(nodeOfTurn(h.db, "trn_1"), undefined, "and the turn is not recorded as run there");
});
