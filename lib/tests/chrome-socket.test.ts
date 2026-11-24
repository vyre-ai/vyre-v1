// Vyre for Chrome connected straight to a Space (lib/chrome-socket.ts): the socket answers only a live device session, every call runs with that session, a Vault fill reaches only
// the extension that asked for it and only for its own person, and a session that is signed out loses its socket.
import test from "node:test";
import assert from "node:assert/strict";
import { CLOSE, HELLO_MS, PING_MS, SILENT_MS, createChromeSocket } from "../chrome-socket.ts";
import type { DirectSession, SocketPeer } from "../chrome-socket.ts";

function fakePeer() {
  const sent: Record<string, any>[] = [];
  let onMsg: (d: { toString(): string }, binary: boolean) => void = () => undefined;
  let onClose: () => void = () => undefined;
  let open = true;
  let code: number | undefined;
  const peer: SocketPeer = {
    send(t) {
      if (!open) return false;
      sent.push(JSON.parse(t));
      return true;
    },
    close(c) {
      if (!open) return;
      open = false;
      code = c;
      onClose();
    },
    onMessage(f) {
      onMsg = f;
    },
    onClose(f) {
      onClose = f;
    },
    get open() {
      return open;
    },
  };
  return {
    peer,
    sent,
    say: (m: unknown) => onMsg(JSON.stringify(m), false),
    raw: (text: string, binary = false) => onMsg(text, binary),
    get code() {
      return code;
    },
    get open() {
      return open;
    },
  };
}

/** Wait for a state, never a fixed time. */
async function until(what: string, cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), what);
}

const IMRAN: DirectSession = {
  sessionId: "ses_imran",
  person: "usr_imran",
  device: "dev_chrome1",
  space: "spc_northwind",
};
const ANDREA: DirectSession = {
  sessionId: "ses_andrea",
  person: "usr_andrea",
  device: "dev_chrome2",
  space: "spc_northwind",
};

function rig() {
  let clock = 1_000_000;
  const timers: { f: () => void; at: number; every?: number; dead?: boolean }[] = [];
  const live = new Map<string, DirectSession>([
    ["tok-imran", IMRAN],
    ["tok-andrea", ANDREA],
  ]);
  const calls: { token: string; cap: string; input: Record<string, unknown> }[] = [];
  /** What the gateway would do for a call; a test replaces it. */
  let gateway: (token: string, cap: string, input: Record<string, unknown>) => Promise<unknown> | unknown = () => ({});
  const socket = createChromeSocket({
    resolve: (t) => live.get(t) ?? null,
    spaceName: () => "Northwind",
    address: () => "https://northwind.example",
    call: async (token, cap, input) => {
      calls.push({ token, cap, input });
      return gateway(token, cap, input);
    },
    now: () => clock,
    setTimer: (f, ms) => {
      const t = { f, at: clock + ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      (t as { dead?: boolean }).dead = true;
    },
    setEvery: (f, ms) => {
      const t = { f, at: clock + ms, every: ms };
      timers.push(t);
      return t;
    },
    clearEvery: (t) => {
      (t as { dead?: boolean }).dead = true;
    },
  });
  return {
    socket,
    calls,
    live,
    set gateway(g: typeof gateway) {
      gateway = g;
    },
    /** Move the clock on and run what came due, in order. */
    pass(ms: number) {
      const end = clock + ms;
      for (;;) {
        const due = timers.filter((t) => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock = due.at;
        if (due.every) due.at += due.every;
        else due.dead = true;
        due.f();
      }
      clock = end;
    },
  };
}

async function signedIn(r: ReturnType<typeof rig>, token = "tok-imran") {
  const p = fakePeer();
  r.socket.accept(p.peer);
  p.say({ type: "hello", token });
  await until("the socket says it is ready", () => p.sent.some((m) => m["type"] === "ready"));
  return p;
}

test("the socket answers nothing before a hello, refuses a token nobody issued, and gives up on a silent socket after ten seconds", async () => {
  const r = rig();
  const quiet = fakePeer();
  r.socket.accept(quiet.peer);
  quiet.say({ id: "r1", type: "bridge", op: "hello", input: {} });
  assert.equal(quiet.code, CLOSE.unauthenticated, "a request before the hello ends the socket");
  assert.deepEqual(quiet.sent, [{ type: "refused", code: "signed_out" }]);
  assert.equal(r.calls.length, 0);

  const wrong = fakePeer();
  r.socket.accept(wrong.peer);
  wrong.say({ type: "hello", token: "tok-nobody" });
  assert.equal(wrong.code, CLOSE.unauthenticated);
  assert.deepEqual(wrong.sent, [{ type: "refused", code: "signed_out" }]);

  const silent = fakePeer();
  r.socket.accept(silent.peer);
  r.pass(HELLO_MS - 1);
  assert.equal(silent.open, true);
  r.pass(1);
  assert.equal(silent.code, CLOSE.unauthenticated);
  assert.equal(r.socket.connected, 0);
});

test("a live session is told the Space and the person, and its calls go to the gateway with that session and nobody else's", async () => {
  const r = rig();
  const p = await signedIn(r);
  assert.deepEqual(
    p.sent.find((m) => m["type"] === "ready"),
    { type: "ready", space: { id: "spc_northwind", name: "Northwind" }, person: "usr_imran" },
  );
  r.gateway = (_t, cap) => (cap === "vault.site_rules.list" ? { sites: [{ host: "a.example" }] } : {});
  p.say({ id: "r1", type: "invoke", capability: "vault.site_rules.list", input: {} });
  await until("the call is answered", () => p.sent.some((m) => m["id"] === "r1"));
  assert.deepEqual(
    p.sent.find((m) => m["id"] === "r1"),
    { id: "r1", ok: true, output: { sites: [{ host: "a.example" }] } },
  );
  assert.deepEqual(r.calls, [{ token: "tok-imran", cap: "vault.site_rules.list", input: {} }]);

  // the Space switcher's list is this one Space, at the address people reach it at
  p.say({ id: "r2", type: "bridge", op: "hello", input: {} });
  await until("hello is answered", () => p.sent.some((m) => m["id"] === "r2"));
  const hello = p.sent.find((m) => m["id"] === "r2")!["output"];
  assert.deepEqual(hello.spaces, [{ id: "spc_northwind", name: "Northwind", webUrl: "https://northwind.example" }]);
  assert.equal(hello.active, "spc_northwind");

  // nothing off the extension's own list reaches the gateway
  const before = r.calls.length;
  p.say({ id: "r3", type: "invoke", capability: "records.delete", input: {} });
  await until("the refusal is answered", () => p.sent.some((m) => m["id"] === "r3"));
  assert.equal(p.sent.find((m) => m["id"] === "r3")!["error"].code, "not_allowed");
  assert.equal(r.calls.length, before);

  // a gateway refusal comes back with its own code
  r.gateway = () => {
    throw Object.assign(new Error("Sign in to Vyre on this computer."), { code: "auth.unauthenticated" });
  };
  p.say({ id: "r4", type: "invoke", capability: "vault.site_rules.list", input: {} });
  await until("the gateway's refusal is answered", () => p.sent.some((m) => m["id"] === "r4"));
  assert.equal(p.sent.find((m) => m["id"] === "r4")!["error"].code, "auth.unauthenticated");
});

test("a Vault fill goes down the socket that asked, once, only while its call runs and only for that socket's person", async () => {
  const r = rig();
  const imran = await signedIn(r, "tok-imran");
  const andrea = await signedIn(r, "tok-andrea");
  const REF = "w1-0123456789abcdef01234567";
  const pushes = (p: ReturnType<typeof fakePeer>) => p.sent.filter((m) => m["type"] === "fill");

  // the Vault calls its browser place while the fill runs: the value goes to the extension that minted the ref
  let delivered: boolean | null = null;
  r.gateway = (_t, cap, input) => {
    if (cap !== "vault.fill") return {};
    const ref = (input["target"] as { ref: string }).ref;
    delivered = r.socket.fill(ref, "s3cret-value", { kind: "person", id: "usr_imran" });
    return { filled: delivered, field: "password", where: "host" };
  };
  imran.say({
    id: "f1",
    type: "invoke",
    capability: "vault.fill",
    input: { handle: "#Fieldbook.password", target: { kind: "browser", ref: REF } },
  });
  await until("the fill is answered", () => imran.sent.some((m) => m["id"] === "f1"));
  assert.equal(delivered, true);
  assert.deepEqual(pushes(imran), [{ type: "fill", ref: REF, value: "s3cret-value" }]);
  assert.deepEqual(pushes(andrea), [], "another person's extension never sees it");
  const at = imran.sent.findIndex((m) => m["type"] === "fill");
  assert.ok(at < imran.sent.findIndex((m) => m["id"] === "f1"), "the value lands before the answer");

  // the call is over: the same ref delivers nothing
  assert.equal(r.socket.fill(REF, "again", { kind: "person", id: "usr_imran" }), false);
  assert.equal(pushes(imran).length, 1);

  // a fill that ran for someone else is refused even with a waiting ref (an agent acting for another person, or another person's own call)
  r.gateway = (_t, cap, input) => {
    if (cap !== "vault.fill") return {};
    const ref = (input["target"] as { ref: string }).ref;
    assert.equal(r.socket.fill(ref, "not-yours", { kind: "person", id: "usr_andrea" }), false);
    assert.equal(r.socket.fill(ref, "not-yours", { kind: "agent", id: "agt_scout", actingFor: "usr_andrea" }), false);
    return { filled: false };
  };
  imran.say({
    id: "f2",
    type: "invoke",
    capability: "vault.fill",
    input: { handle: "#Fieldbook.password", target: { kind: "browser", ref: REF } },
  });
  await until("the second fill is answered", () => imran.sent.some((m) => m["id"] === "f2"));
  assert.equal(pushes(imran).length, 1);

  // an agent working for this person fills into this person's Chrome
  r.gateway = (_t, cap, input) => {
    if (cap !== "vault.fill") return {};
    const ok = r.socket.fill((input["target"] as { ref: string }).ref, "for-imran", {
      kind: "agent",
      id: "agt_scout",
      actingFor: "usr_imran",
    });
    return { filled: ok };
  };
  imran.say({
    id: "f3",
    type: "invoke",
    capability: "vault.fill",
    input: { handle: "#Fieldbook.password", target: { kind: "browser", ref: REF } },
  });
  await until("the third fill is answered", () => imran.sent.some((m) => m["id"] === "f3"));
  assert.equal(pushes(imran).length, 2);

  // a ref nobody minted, and a ref too short to be one
  assert.equal(r.socket.fill("w9-ffffffffffffffffffffffff", "x", { kind: "person", id: "usr_imran" }), false);
  imran.say({
    id: "f4",
    type: "invoke",
    capability: "vault.fill",
    input: { handle: "#Fieldbook.password", target: { kind: "browser", ref: "short" } },
  });
  await until("the bad ref is answered", () => imran.sent.some((m) => m["id"] === "f4"));
  assert.equal(imran.sent.find((m) => m["id"] === "f4")!["ok"], false);
  // no value is left anywhere in what either socket was sent beyond the two deliveries
  assert.equal(JSON.stringify(andrea.sent).includes("s3cret-value"), false);
});

test("a beat keeps the socket: a ping every 20 seconds, a quiet extension is dropped, a signed-out session loses its socket at the next beat", async () => {
  const r = rig();
  const p = await signedIn(r);
  r.pass(PING_MS);
  assert.deepEqual(p.sent.at(-1), { type: "ping" });
  p.say({ type: "pong" });
  r.pass(PING_MS);
  assert.equal(p.open, true);

  // signed out in Settings: the session no longer resolves
  r.live.delete("tok-imran");
  r.pass(PING_MS);
  assert.equal(p.code, CLOSE.revoked);
  assert.equal(r.socket.connected, 0);

  // an extension that stops answering is let go
  const q = await signedIn(r, "tok-andrea");
  r.pass(SILENT_MS + PING_MS);
  assert.equal(q.open, false);
  assert.equal(r.socket.connected, 0);
});

test("a newer socket of the same session replaces the older, and closing the module ends every socket", async () => {
  const r = rig();
  const first = await signedIn(r);
  const second = await signedIn(r);
  assert.equal(first.code, CLOSE.replaced);
  assert.equal(second.open, true);
  assert.equal(r.socket.connected, 1);
  assert.ok(r.socket.bridgeOf("usr_imran"), "the person's extension can be reached for agent calls");
  assert.equal(r.socket.bridgeOf("usr_andrea"), null);
  r.socket.close();
  assert.equal(second.open, false);
  assert.equal(r.socket.connected, 0);
});

test("frames that are not JSON objects, and binary frames, are ignored", async () => {
  const r = rig();
  const p = await signedIn(r);
  const n = p.sent.length;
  p.raw("not json");
  p.raw("[1,2]");
  p.raw('{"id":"b1","type":"bridge","op":"hello","input":{}}', true);
  await new Promise((res) => setImmediate(res));
  assert.equal(p.sent.length, n);
  assert.equal(p.open, true);
});

test("a second extension cannot take over a ref the first is waiting on", async () => {
  const r = rig();
  const imran = await signedIn(r, "tok-imran");
  const andrea = await signedIn(r, "tok-andrea");
  const REF = "w9-0123456789abcdef01234567";
  let release: (v: unknown) => void = () => {};
  const waitingOn = new Promise((res) => (release = res));
  let andreaAnswer: Record<string, unknown> | undefined;
  r.gateway = async (_t, cap) => {
    if (cap !== "vault.fill") return {};
    await waitingOn;
    return { filled: true };
  };
  imran.say({
    id: "a1",
    type: "invoke",
    capability: "vault.fill",
    input: { handle: "#X.password", target: { kind: "browser", ref: REF } },
  });
  await new Promise((x) => setTimeout(x, 20));
  andrea.say({
    id: "b1",
    type: "invoke",
    capability: "vault.fill",
    input: { handle: "#X.password", target: { kind: "browser", ref: REF } },
  });
  await until("the second is answered", () => (andreaAnswer = andrea.sent.find((m) => m["id"] === "b1")) !== undefined);
  assert.equal(andreaAnswer?.["ok"], false, "refused: the ref is the first extension's");
  assert.equal(r.socket.fill(REF, "v", { kind: "person", id: "usr_imran" }), true, "and the first can still be filled");
  release(true);
});
