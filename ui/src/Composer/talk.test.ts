// Talk's engine against a fake Deepgram socket and a fake mic: first press, cancel, every failure, words end to end. Nothing here sends, and what was heard stays when anything fails.
import test from "node:test";
import assert from "node:assert/strict";
import { LINE, joinWords, levelOf, micLine, openWebMic, sessionLine, startTalk, toPcm16 } from "./talk.ts";
import type { TalkDeps, TalkEvents, TalkSession, TalkSocket } from "./talk.ts";

const SESSION: TalkSession = { provider: "deepgram", url: "wss://api.deepgram.com/v1/listen?model=nova-3", protocols: ["bearer", "jwt"], source: "own", expiresIn: 30 };
const results = (text: string, final: boolean): string => JSON.stringify({ type: "Results", is_final: final, channel: { alternatives: [{ transcript: text }] } });
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

class FakeSocket implements TalkSocket {
  readyState = 0; binaryType?: string; onopen: TalkSocket["onopen"] = null; onmessage: TalkSocket["onmessage"] = null; onerror: TalkSocket["onerror"] = null; onclose: TalkSocket["onclose"] = null;
  sent: (string | ArrayBuffer)[] = []; closed = false; constructor(public url: string, public protocols: string[]) {}
  send(d: string | ArrayBuffer): void { this.sent.push(d); }
  close(): void { this.closed = true; }
  open(): void { this.readyState = 1; this.onopen?.({}); }
  say(s: string): void { this.onmessage?.({ data: s }); }
  drop(): void { this.readyState = 3; this.onclose?.({}); }
}

function rig(o: Partial<TalkDeps> & { warm?: boolean } = {}) {
  const log = { words: [] as string[], lines: [] as string[], ended: 0, listening: 0, needsKey: 0, off: [] as string[], levels: [] as number[] };
  const sockets: FakeSocket[] = [];
  let audio: ((p: ArrayBuffer, l: number) => void) | null = null;
  const mic = { stopped: 0 };
  const later: (() => void)[] = [];
  let order: string[] = [];
  const deps: TalkDeps = {
    session: async () => { order.push("session"); return SESSION; },
    openMic: async (on) => { order.push("mic"); audio = on; return { stop: () => { mic.stopped++; } }; },
    openSocket: (url, protocols) => { const s = new FakeSocket(url, protocols); sockets.push(s); return s; },
    online: () => true, now: () => 0, later: (fn) => { later.push(fn); return 0; }, shell: "web", ...o,
  };
  const ev: TalkEvents = {
    words: (t) => log.words.push(t), level: (v) => log.levels.push(v), listening: () => { log.listening++; }, ended: () => { log.ended++; }, failed: (l) => log.lines.push(l), needsKey: () => { log.needsKey++; }, off: (l) => log.off.push(l),
  };
  const run = startTalk(deps, ev, { warm: o.warm ?? false });
  return { run, log, sockets, mic, later, order: () => order, speak: (b: ArrayBuffer, l = 0.5) => audio?.(b, l), reset: () => { order = []; } };
}

test("end to end: a fake Deepgram socket opens with the token as a subprotocol, audio held until it opens, interim words replaced, finals kept, close asks for the last words", async () => {
  const t = rig();
  await tick();
  assert.deepEqual(t.order(), ["session", "mic"], "a first press learns what covers the person before any permission prompt");
  const s = t.sockets[0]!;
  assert.deepEqual(s.protocols, ["bearer", "jwt"]);
  assert.equal(s.url, SESSION.url);
  const early = new ArrayBuffer(4);
  t.speak(early);
  assert.deepEqual(s.sent, [], "nothing goes before the socket is open");
  s.open();
  assert.deepEqual(s.sent, [early], "what was said while it opened is not lost");
  assert.equal(t.log.listening, 1);
  s.say(results("also check", false));
  s.say(results("also check how", false));
  s.say(results("Also check how it looks.", true));
  s.say(results("on a", false));
  assert.deepEqual(t.log.words, ["also check", "also check how", "Also check how it looks.", "Also check how it looks. on a"]);
  t.speak(new ArrayBuffer(2), 0.7);
  assert.equal(s.sent.length, 2);
  assert.equal(t.log.levels.at(-1), 0.7);
  t.run.stop();
  assert.equal(t.mic.stopped, 1, "the mic stops at once");
  assert.equal(s.sent.at(-1), JSON.stringify({ type: "CloseStream" }));
  s.say(results("on a phone.", true));
  assert.equal(t.log.words.at(-1), "Also check how it looks. on a phone.", "the words after release still land");
  s.readyState = 3; s.onclose?.({});
  assert.equal(t.log.ended, 1);
  assert.deepEqual(t.log.lines, []);
});

test("a stop with no answer from the provider still ends", async () => {
  const t = rig();
  await tick();
  t.sockets[0]!.open();
  t.run.stop();
  assert.equal(t.log.ended, 0);
  t.later[0]!();
  assert.equal(t.log.ended, 1);
  assert.equal(t.sockets[0]!.closed, true);
});

test("a key known to work starts the mic with the press, so the first word is not lost to the round trip", async () => {
  const t = rig({ warm: true });
  await tick();
  assert.deepEqual(t.order(), ["mic", "session"]);
});

test("first press with no key: no mic is opened, the sheet is asked for, and a warm mic is put back", async () => {
  const noKey = async (): Promise<TalkSession> => { throw Object.assign(new Error("Talk needs a key."), { code: "validation.precondition_failed", details: { reason: "no_key" } }); };
  const cold = rig({ session: noKey });
  await tick();
  assert.equal(cold.log.needsKey, 1);
  assert.deepEqual(cold.log.lines, []);
  assert.deepEqual(cold.order(), [], "no permission prompt before a key");
  const warm = rig({ session: noKey, warm: true });
  await tick();
  assert.equal(warm.log.needsKey, 1);
  assert.equal(warm.mic.stopped, 1);
});

test("off, revoked, a refused mic, no network and a provider that is down each give one plain line", async () => {
  const off = rig({ session: async () => { throw Object.assign(new Error("Talk is off."), { code: "validation.precondition_failed", details: { reason: "off" } }); } });
  await tick();
  assert.deepEqual(off.log.off, ["Talk is off."]);

  const revoked = "Deepgram no longer accepts your key. Add a new one in Settings, AI, Voice.";
  const gone = rig({ session: async () => { throw Object.assign(new Error(revoked), { code: "provider.auth_failed", details: { reason: "revoked" } }); } });
  await tick();
  assert.deepEqual(gone.log.lines, [revoked]);

  const refused = rig({ openMic: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); }, shell: "mac" });
  await tick();
  assert.deepEqual(refused.log.lines, [LINE.micMac]);

  const offline = rig({ session: async () => { throw new TypeError("Failed to fetch"); }, online: () => false });
  await tick();
  assert.deepEqual(offline.log.lines, [LINE.network]);

  const down = rig();
  await tick();
  down.sockets[0]!.onerror?.({});
  assert.deepEqual(down.log.lines, [LINE.down], "a socket that never opens");
  assert.equal(down.mic.stopped, 1);
});

test("a drop mid-sentence is one line, and the words already heard stay", async () => {
  const t = rig();
  await tick();
  const s = t.sockets[0]!;
  s.open();
  s.say(results("kept words", true));
  s.drop();
  assert.deepEqual(t.log.lines, [LINE.dropped]);
  assert.equal(t.log.words.at(-1), "kept words");
  assert.equal(t.log.ended, 0);
  s.say(results("late", true));
  assert.equal(t.log.words.at(-1), "kept words", "nothing arrives after the end");
});

test("a provider Error frame and an offline drop say the right thing", async () => {
  const t = rig();
  await tick();
  t.sockets[0]!.open();
  t.sockets[0]!.say(JSON.stringify({ type: "Error", description: "bad" }));
  assert.deepEqual(t.log.lines, [LINE.down]);
  const off = rig({ online: () => false });
  await tick();
  off.sockets[0]!.open();
  off.sockets[0]!.drop();
  assert.deepEqual(off.log.lines, [LINE.network]);
});

test("cancel ends everything with no callback, even mid-start, and no late token opens a socket", async () => {
  let give: (s: TalkSession) => void = () => undefined;
  const t = rig({ session: () => new Promise((r) => { give = r; }) });
  t.run.cancel();
  give(SESSION);
  await tick();
  assert.equal(t.sockets.length, 0);
  assert.equal(t.log.ended, 0);
  const u = rig();
  await tick();
  u.sockets[0]!.open();
  u.run.cancel();
  assert.equal(u.mic.stopped, 1);
  assert.equal(u.sockets[0]!.closed, true);
  assert.equal(u.log.ended, 0);
});

test("a token that went stale behind a permission prompt is minted again before the socket opens", async () => {
  let clock = 0, sessions = 0;
  const t = rig({ now: () => clock, session: async () => { sessions++; return SESSION; }, openMic: async () => { clock = 40_000; return { stop: () => undefined }; } });
  await tick();
  assert.equal(sessions, 2);
  assert.equal(t.sockets.length, 1);
});

test("lines: a server's sentence is used as it is, a raw failure is not, and the mic line follows the shell", () => {
  assert.equal(sessionLine(Object.assign(new Error("Plain words."), { code: "provider.auth_failed" }), true), "Plain words.");
  assert.equal(sessionLine(new TypeError("Failed to fetch"), true), LINE.generic);
  assert.equal(micLine({ name: "NotFoundError" }, "web"), LINE.noMic);
  assert.equal(micLine({ name: "NoMicApi" }, "mac"), LINE.noMicApi);
  assert.equal(micLine({ name: "NotAllowedError" }, "web"), LINE.micWeb);
  assert.equal(joinWords(["a", "b"], ""), "a b");
});

test("audio: 48 kHz floats become 16 kHz little-endian 16-bit, and the level stays between 0 and 1", () => {
  const input = new Float32Array(4800).fill(0.5);
  const pcm = new DataView(toPcm16(input, 48_000));
  assert.equal(pcm.byteLength, 3200);
  assert.equal(pcm.getInt16(0, true), Math.round(0.5 * 32767));
  assert.equal(new DataView(toPcm16(new Float32Array([2, -2]), 16_000)).getInt16(2, true), -32768, "clipped, not wrapped");
  assert.equal(levelOf(new Float32Array(10)), 0);
  assert.ok(levelOf(new Float32Array(10).fill(1)) <= 1);
});

test("the web mic: no API is its own error, tracks stop, and a refused mic closes the audio context", async () => {
  await assert.rejects(() => openWebMic(() => undefined, {}), (e) => (e as Error).name === "NoMicApi");
  let closed = 0, stopped = 0, processed = 0;
  class Ctx {
    sampleRate = 48_000; destination = {};
    resume = async () => undefined; close = async () => { closed++; };
    createMediaStreamSource = () => ({ connect: () => undefined, disconnect: () => undefined });
    createScriptProcessor = () => { const p = { onaudioprocess: null as null | ((e: unknown) => void), connect: () => undefined, disconnect: () => undefined }; queueMicrotask(() => p.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4096) } })); return p; };
  }
  const refused = { AudioContext: Ctx as never, navigator: { mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); } } } };
  await assert.rejects(() => openWebMic(() => undefined, refused), (e) => (e as Error).name === "NotAllowedError");
  assert.equal(closed, 1);
  const good = { AudioContext: Ctx as never, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }) } } };
  const mic = await openWebMic(() => { processed++; }, good);
  await tick();
  assert.equal(processed, 1);
  mic.stop();
  assert.equal(stopped, 1);
  assert.equal(closed, 2);
});
