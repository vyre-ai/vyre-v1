// Ending a session is in force on the live socket the moment the call returns. A booted daemon, a member who joined and holds an open live socket (as the app does). Each way a session ends
// (signing out, revoking the session from the devices list, revoking the device, the owner suspending the person) is followed at once by a `call` frame on the socket that was already open:
// it must be refused, not run as the person whose session just ended. The token over HTTP is refused too.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

interface Live { call(cap: string, input?: unknown): Promise<{ ok: boolean; code?: string } | { closed: number }>; close(): void }

/** The member's own live socket, opened with their token, as the app opens it. A call answers its `res` frame, or the close code when the socket closes first. */
async function socket(d: Daemon, token: string, device: string): Promise<Live> {
  const ws = new WebSocket(`${d.url.replace(/^http/, "ws")}/sync/v1/ws`, { headers: { authorization: `Bearer ${token}` } } as never);
  const waiting = new Map<number, (r: { ok: boolean; code?: string } | { closed: number }) => void>();
  ws.addEventListener("message", (e) => {
    let f: { t?: string; id?: number; ok?: boolean; error?: { code?: string } } = {};
    try { f = JSON.parse(String(e.data)) as typeof f; } catch { return; }
    if (f.t === "res" && typeof f.id === "number") { waiting.get(f.id)?.({ ok: f.ok === true, ...(f.error?.code ? { code: f.error.code } : {}) }); waiting.delete(f.id); }
  });
  ws.addEventListener("close", (e) => { for (const w of waiting.values()) w({ closed: e.code }); waiting.clear(); });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("the live socket did not open"))); });
  ws.send(JSON.stringify({ t: "hello", hello: { deviceId: device, deviceClass: "web", appVersion: "1.2.3", registryHash: "unknown", cursor: 0, epoch: 0, replica: { entities: {} } } }));
  let id = 0;
  return {
    call: (cap, input = {}) => new Promise((resolve) => {
      if (ws.readyState !== WebSocket.OPEN) { resolve({ closed: -1 }); return; }
      const n = ++id;
      waiting.set(n, resolve);
      ws.send(JSON.stringify({ t: "call", id: n, cap, input }));
    }),
    close: () => ws.close(),
  };
}

type Ending = "identity.sign_out" | "devices.sessions.revoke" | "devices.revoke" | "members.suspend";
const ENDINGS: Ending[] = ["identity.sign_out", "devices.sessions.revoke", "devices.revoke", "members.suspend"];

test("every way a session ends refuses the next call on the live socket that was already open", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  const open: Live[] = [];
  try {
    for (const [i, ending] of ENDINGS.entries()) {
      const who = await join(d, `member${i}`);
      const mine = (await ok(d, who.token, "devices.sessions.list", {})).sessions as Array<{ id: string; deviceId?: string; current?: boolean }>;
      const current = mine.find((s) => s.current) ?? mine[0]!;
      const live = await socket(d, who.token, current.deviceId ?? `dev_${i}`);
      open.push(live);
      assert.deepEqual(await live.call("identity.whoami"), { ok: true }, `${ending}: the socket works before`);
      if (ending === "identity.sign_out") await ok(d, who.token, "identity.sign_out", {});
      else if (ending === "devices.sessions.revoke") await ok(d, who.token, "devices.sessions.revoke", { sessionId: current.id });
      else if (ending === "devices.revoke") await ok(d, who.token, "devices.revoke", { deviceId: current.deviceId });
      else await ok(d, d.token, "members.suspend", { personId: who.personId });
      const after = await live.call("identity.whoami");
      assert.ok("closed" in after || after.ok === false, `${ending}: the open socket refuses the next call (got ${JSON.stringify(after)})`);
      assert.equal((await api(d, who.token, "identity.whoami", {})).status, 401, `${ending}: the token is refused over HTTP too`);
    }
  } finally {
    for (const l of open) l.close();
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
