// A person's computer answers the Space's questions about its own Chrome (lane l-chrome2a), for that person only: the Space runs the turn and asks; the computer's daemon owns the bridge and answers with
// its own port. Chrome events go up the socket as chrome_event frames. A question for anyone else, before the computer knows whose it is, or about anything but Chrome, gets no answer from the Chrome.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDeviceLink } from "../src/compute/device-link.ts";
import { composePorts, createRemotePort } from "../../lib/personal-chrome-remote.ts";
import type { PersonalChrome } from "../../lib/personal-chrome.ts";

function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  let onOpen: () => void = () => {}, onMessage: (d: string) => void = () => {}, onClose: () => void = () => {};
  const sock = {
    send: (d: string | Uint8Array) => { sent.push(JSON.parse(String(d))); }, close: () => onClose(), bufferedAmount: 0,
    onOpen: (f: () => void) => { onOpen = f; }, onMessage: (f: (d: string | Uint8Array) => void) => { onMessage = f as never; }, onClose: (f: () => void) => { onClose = f; },
  };
  return { sock, sent, open: () => onOpen(), say: (m: Record<string, unknown>) => onMessage(JSON.stringify(m)) };
}

async function link(chrome: { answer(k: string, i: unknown): Promise<unknown>; onEvent(f: (e: Record<string, unknown>) => void): () => void }) {
  const fake = fakeSocket();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-devchrome-"));
  const ac = new AbortController();
  const done = runDeviceLink({
    server: "https://space.example", token: "tok", dataDir: dir, name: "Olivia's Mac", engines: [], launcher: { spawn: async () => { throw new Error("no engine"); } },
    socket: () => fake.sock, sleep: async () => undefined, signal: ac.signal, log: () => undefined, chrome,
  });
  await new Promise((r) => setTimeout(r, 10));
  fake.open();
  return { fake, stop: async () => { ac.abort(); await done; fs.rmSync(dir, { recursive: true, force: true }); } };
}
const wait = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); };

test("the computer answers Chrome questions for its own person only, and nothing else", async () => {
  const seen: string[] = [];
  const emit: Array<(e: Record<string, unknown>) => void> = [];
  const l = await link({ answer: async (k, i) => { seen.push(k); return k === "chrome.available" ? (i as { space: string }).space === "spc_a" : { sent: true }; }, onEvent: (f) => { emit.push(f); return () => { emit.length = 0; }; } });
  try {
    l.fake.say({ t: "ask", id: "q0", kind: "chrome.available", input: { person: "usr_olivia", space: "spc_a" } });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(l.fake.sent.filter((m) => m["t"] === "ask_res").map((m) => [m["id"], m["ok"]]), [["q0", false]], "before it knows whose it is, refused without asking the Chrome");
    l.fake.say({ t: "ready", person: "usr_olivia" });
    l.fake.say({ t: "ask", id: "q1", kind: "chrome.available", input: { person: "usr_olivia", space: "spc_a" } });
    l.fake.say({ t: "ask", id: "q2", kind: "chrome.call", input: { person: "usr_noah", tool: "chrome_send" } });
    l.fake.say({ t: "ask", id: "q3", kind: "files.read", input: {} });
    await wait(() => l.fake.sent.filter((m) => m["t"] === "ask_res").length >= 3 + 1);
    const res = l.fake.sent.filter((m) => m["t"] === "ask_res");
    assert.deepEqual(res.filter((m) => m["id"] === "q1").map((m) => [m["ok"], m["result"]]), [[true, true]]);
    assert.equal(res.find((m) => m["id"] === "q2")!["ok"], false, "another person's agent is refused");
    assert.equal(res.find((m) => m["id"] === "q3"), undefined, "a question that is not about Chrome is not the Chrome's");
    assert.deepEqual(seen, ["chrome.available"], "the Chrome answered only the one it should");
    emit[0]!({ event: "held", id: "hld_ab12", agent: "agt_scout" });
    await wait(() => l.fake.sent.some((m) => m["t"] === "chrome_event"));
    assert.deepEqual(l.fake.sent.find((m) => m["t"] === "chrome_event")!["event"], { event: "held", id: "hld_ab12", agent: "agt_scout" });
  } finally { await l.stop(); }
});

test("the Space's port asks the person's computer, sends what follows to the one that said yes, and keeps what its events say", async () => {
  const asked: Array<[string, string, unknown]> = [];
  const remote = createRemotePort({
    devices: (p) => (p === "usr_olivia" ? [{ nodeId: "device:d1", person: p }] : []),
    ask: async (n, k, i) => { asked.push([n, k, i]); return k === "chrome.available" ? true : k === "chrome.call" ? { ok: true, heldId: "hld_ab12" } : true; },
  });
  assert.equal(await remote.port.available({ space: "spc_a", person: "usr_noah" }), false, "nobody else's");
  assert.equal(await remote.port.available({ space: "spc_a", person: "usr_olivia" }), true);
  const out = await remote.port.call({ tool: "chrome_act", args: { ref: "e1" }, agent: { id: "agt_scout", name: "Scout" }, space: "spc_a", thread: "thr_1", timeoutMs: 30_000 });
  assert.equal(out["heldId"], "hld_ab12");
  assert.deepEqual([asked[1]![0], asked[1]![1], (asked[1]![2] as { person: string }).person], ["device:d1", "chrome.call", "usr_olivia"]);
  remote.onEvent({ nodeId: "device:d1", person: "usr_olivia" }, { event: "held", id: "hld_ab12", agent: "agt_scout", kind: "send", card: { to: "d@x.test", site: "mail.test" } });
  remote.onEvent({ nodeId: "device:d1", person: "usr_olivia" }, { event: "frame", agent: "agt_scout", site: "mail.test", thumb: "data:image/jpeg;base64,AA==" });
  assert.equal((await remote.port.held("hld_ab12"))!.card!["to"], "d@x.test");
  assert.equal(remote.port.frame("agt_scout")!.site, "mail.test");
  remote.port.drop("hld_ab12");
  remote.port.takeOver("agt_scout");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(asked.slice(2).map((a) => [a[0], a[1]]), [["device:d1", "chrome.drop"], ["device:d1", "chrome.takeover"]]);
});

test("the server uses its own Chrome first and the person's computer second, and sends the rest of the work where the yes came from", async () => {
  const log: string[] = [];
  const mk = (name: string, yes: boolean): PersonalChrome => ({ available: async () => yes, call: async () => { log.push(`${name} call`); return {}; }, held: async () => null, frame: () => null, plan: () => null, drop: () => { log.push(`${name} drop`); }, takeOver() {}, watch() {} });
  const p = composePorts(mk("local", false), mk("remote", true));
  assert.equal(await p.available({ space: "spc_a", person: "usr_olivia" }), true);
  await p.call({ tool: "chrome_snapshot", args: {}, agent: { id: "a", name: "a" }, space: "spc_a", timeoutMs: 1 });
  assert.deepEqual(log, ["remote call"]);
  const q = composePorts(mk("local", true), mk("remote", true));
  await q.available({ space: "spc_a", person: "usr_olivia" });
  await q.call({ tool: "chrome_snapshot", args: {}, agent: { id: "a", name: "a" }, space: "spc_a", timeoutMs: 1 });
  assert.equal(log.at(-1), "local call");
  assert.equal(await composePorts(mk("l", false), mk("r", false)).available({ space: "s", person: "p" }), false);
});
