// Ending a session is in force on every live connection the moment the call returns. A booted daemon, members who joined and hold an open live socket (as the app does).
//   1  every way a session ends (signing out, revoking the session, revoking the device, suspending or removing the person) refuses the next call on the socket that was already open;
//   2  the per-frame check proves itself with the close-on-end switched off (liveCloseOnEnd: false): a sync frame sent after the end is not handled, and nothing the Space sends afterwards
//      (a `changed` tick, a sync batch) reaches the socket; it is closed instead;
//   3  a socket that ends its own session gets the answer to that call, then closes;
//   4  the person's own computer link to the Space (/compute/stream with their session token) closes at once, not at the next recheck.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

interface Frame { t?: string; id?: number; ok?: boolean; error?: { code?: string } }
interface Live {
  call(cap: string, input?: unknown): Promise<{ ok: boolean; code?: string } | { closed: number }>;
  raw(f: unknown): void;
  frames: Frame[];
  closed: Promise<number>;
  close(): void;
}
const within = <T,>(p: Promise<T>, ms: number, none: T): Promise<T> => Promise.race([p, new Promise<T>((r) => { const t = setTimeout(() => r(none), ms); t.unref?.(); })]);

/** The member's own live socket, opened with their token, as the app opens it. A call answers its `res` frame, or the close code when the socket closes first. Every frame is kept. */
async function socket(d: Daemon, token: string, device: string): Promise<Live> {
  const ws = new WebSocket(`${d.url.replace(/^http/, "ws")}/sync/v1/ws`, { headers: { authorization: `Bearer ${token}` } } as never);
  const waiting = new Map<number, (r: { ok: boolean; code?: string } | { closed: number }) => void>();
  const frames: Frame[] = [];
  let onClosed!: (code: number) => void;
  const closed = new Promise<number>((r) => { onClosed = r; });
  ws.addEventListener("message", (e) => {
    let f: Frame = {};
    try { f = JSON.parse(String(e.data)) as Frame; } catch { return; }
    frames.push(f);
    if (f.t === "res" && typeof f.id === "number") { waiting.get(f.id)?.({ ok: f.ok === true, ...(f.error?.code ? { code: f.error.code } : {}) }); waiting.delete(f.id); }
  });
  ws.addEventListener("close", (e) => { for (const w of waiting.values()) w({ closed: e.code }); waiting.clear(); onClosed(e.code); });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("the live socket did not open"))); });
  const hello = { t: "hello", hello: { deviceId: device, deviceClass: "web", appVersion: "1.2.3", registryHash: "unknown", cursor: 0, epoch: 0, replica: { entities: {} } } };
  ws.send(JSON.stringify(hello));
  let id = 0;
  return {
    call: (cap, input = {}) => new Promise((resolve) => {
      if (ws.readyState !== WebSocket.OPEN) { resolve({ closed: -1 }); return; }
      const n = ++id;
      waiting.set(n, resolve);
      ws.send(JSON.stringify({ t: "call", id: n, cap, input }));
    }),
    raw: (f) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(f ?? hello)); },
    frames, closed,
    close: () => ws.close(),
  };
}

type Ending = "identity.sign_out" | "devices.sessions.revoke" | "devices.revoke" | "members.suspend" | "members.remove";
const ENDINGS: Ending[] = ["identity.sign_out", "devices.sessions.revoke", "devices.revoke", "members.suspend", "members.remove"];

async function member(d: Daemon, name: string) {
  const who = await join(d, name);
  const mine = (await ok(d, who.token, "devices.sessions.list", {})).sessions as Array<{ id: string; deviceId?: string; current?: boolean }>;
  return { who, current: mine.find((s) => s.current) ?? mine[0]! };
}
async function end(d: Daemon, ending: Ending, m: Awaited<ReturnType<typeof member>>): Promise<void> {
  if (ending === "identity.sign_out") await ok(d, m.who.token, "identity.sign_out", {});
  else if (ending === "devices.sessions.revoke") await ok(d, m.who.token, "devices.sessions.revoke", { sessionId: m.current.id });
  else if (ending === "devices.revoke") await ok(d, m.who.token, "devices.revoke", { deviceId: m.current.deviceId });
  else if (ending === "members.suspend") await ok(d, d.token, "members.suspend", { personId: m.who.personId });
  else await ok(d, d.token, "members.remove", { personId: m.who.personId, plan: [] });
}

test("every way a session ends refuses the next call on the live socket that was already open", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  const open: Live[] = [];
  try {
    for (const [i, ending] of ENDINGS.entries()) {
      const m = await member(d, `member${i}`);
      const live = await socket(d, m.who.token, m.current.deviceId ?? `dev_${i}`);
      open.push(live);
      assert.deepEqual(await live.call("identity.whoami"), { ok: true }, `${ending}: the socket works before`);
      await end(d, ending, m);
      const after = await live.call("identity.whoami");
      assert.ok("closed" in after || after.ok === false, `${ending}: the open socket refuses the next call (got ${JSON.stringify(after)})`);
      assert.equal((await api(d, m.who.token, "identity.whoami", {})).status, 401, `${ending}: the token is refused over HTTP too`);
    }
  } finally {
    for (const l of open) l.close();
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the per-frame check alone (no close on end): after a session ends, a sync frame it sends is not handled and nothing more reaches it", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { liveCloseOnEnd: false });
  const open: Live[] = [];
  try {
    for (const [i, ending] of ENDINGS.entries()) {
      for (const way of ["sends a sync frame", "is sent an event"] as const) {
        const m = await member(d, `frame${i}${way.length}`);
        const live = await socket(d, m.who.token, m.current.deviceId ?? `dev_${i}`);
        open.push(live);
        assert.deepEqual(await live.call("identity.whoami"), { ok: true }, `${ending}: the socket works before`);
        await end(d, ending, m);
        const seen = live.frames.length;
        if (way === "sends a sync frame") live.raw(null);   // the sync hello again: a frame the sync session would answer
        else await ok(d, d.token, "channels.create", { name: `after-${i}`, visibility: "public", memberIds: [], agentIds: [] });   // an event the Space publishes to every socket
        const code = await within(live.closed, 5_000, -1);
        // a revoked device, and a suspended or removed person (their devices end), is also purged by sync (4003, with a purge frame telling the app to wipe its copy); a session alone closes as ended (1008)
        const purged = ending === "devices.revoke" || ending === "members.suspend" || ending === "members.remove";
        assert.ok(code === 1008 || (purged && code === 4003), `${ending}, ${way}: the socket is closed as ended (got ${code})`);
        assert.deepEqual(live.frames.slice(seen).filter((f) => !(purged && f.t === "purge")), [], `${ending}, ${way}: nothing reached the socket after the session ended`);
      }
    }
  } finally {
    for (const l of open) l.close();
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("signing out over the socket itself: the answer arrives, then the socket closes", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  let live: Live | undefined;
  try {
    const m = await member(d, "selfout");
    live = await socket(d, m.who.token, m.current.deviceId ?? "dev_self");
    assert.deepEqual(await live.call("identity.sign_out"), { ok: true }, "the sign-out is answered");
    assert.equal(await within(live.closed, 5_000, -1), 1008, "then the socket closes");
    assert.equal((await api(d, m.who.token, "identity.whoami", {})).status, 401);
  } finally {
    live?.close();
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the person's own computer link closes the moment their session ends or they are suspended, not at the next recheck", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { computeStreamRecheckMs: 600_000 });
  const links: WebSocket[] = [];
  try {
    for (const ending of ["identity.sign_out", "members.suspend"] as const) {
      const m = await member(d, `link${ending.length}`);
      const ws = new WebSocket(`${d.url.replace(/^http/, "ws")}/compute/stream`, { headers: { authorization: `Bearer ${m.who.token}` } } as never);
      links.push(ws);
      const ready = new Promise<boolean>((r) => { ws.addEventListener("message", (e) => { try { if ((JSON.parse(String(e.data)) as { t?: string }).t === "ready") r(true); } catch { /* binary */ } }); ws.addEventListener("close", () => r(false)); });
      const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
      assert.equal(await within(ready, 10_000, false), true, `${ending}: the computer linked`);
      ws.send(JSON.stringify({ t: "hello", engines: [] }));
      await end(d, ending, m);
      const code = await within(closed, 5_000, -1);
      assert.notEqual(code, -1, `${ending}: the link closed at once (the recheck is ten minutes away)`);
    }
  } finally {
    for (const w of links) { try { w.close(); } catch { /* gone */ } }
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
