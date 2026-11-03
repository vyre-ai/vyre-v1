// Shared by the one-account live tests (rc.17): Space A runs in this process (a seeded Space, its admin token inviting people), Space B in its own process (a fresh install its owner claimed).
// The identity module's session-token seam is one per process, so the two Spaces never share it. Members join with real key bundles; the device side is the app's own carry code.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { carryBundle, carryWithRecovery, makeBundle } from "../client/src/crypto/keys.ts";
import type { ArgonParams } from "../client/src/crypto/keys.ts";
import { recoverAccountKeys } from "../client/src/crypto/recovery.ts";
import type { CarryCrypto, HomeDeps } from "../apps/app/src/join/identity.ts";
import { api, ok } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

export const FAST: ArgonParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };
export const crypto: CarryCrypto = { carryBundle: (p, b, id) => carryBundle(p, b, id, { argon: FAST }), carryWithRecovery: (c, p, b, id) => carryWithRecovery(c, p, b, id, { argon: FAST }) };
export const PASSWORD = "correct horse battery staple 9";
export const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
export const caller = (d: Daemon | string, token: string | null) => async (cap: string, input: unknown): Promise<unknown> => {
  const url = typeof d === "string" ? d : d.url;
  const r = await fetch(`${url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: { code?: string } };
  if (r.status !== 200) throw Object.assign(new Error(`${cap} ${r.status}`), { status: r.status, code: body.error?.code });
  return body.data;
};
export const deps: HomeDeps = { anonymous: (a) => caller(a, null), signedIn: (a, t) => caller(a, t), device: { deviceName: "A fresh browser", deviceClass: "web" } };
export const spaceOf = async (d: Daemon): Promise<string> => (await ok(d, d.token, "spaces.get")).space.id as string;

/**
 * Space B: a second server in its own process (the identity module's session-token seam is one per process, so two Spaces in one process would mint into one table). A fresh install with its own
 * Space id, claimed by its owner as a person does; `token` is the owner's session, which invites people.
 */
export async function spaceB(id: string, name: string): Promise<Daemon & { dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-oneid-b-"));
  const child = spawn(process.execPath, ["host/src/daemon/main.ts", "--role", "space", "--data-dir", dir, "--port", "0", "--space", id, "--space-name", name], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, VYRE_ADMIN_TOKEN: "oneid-b-admin-token" }, stdio: ["ignore", "pipe", "inherit"] });
  const printed = await new Promise<{ url: string; claim: string }>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`B did not start: ${out}`)), 30_000);
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      const url = /listening on (http\S+)/.exec(out)?.[1], claim = /Claim this Space[^\n]*?: (http\S+)/.exec(out)?.[1];
      if (url && claim) { clearTimeout(timer); resolve({ url, claim }); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`B exited ${String(code)}: ${out}`)); });
  });
  const link = new URL(printed.claim);
  const made = await makeBundle("the owner of B's password", "OWNR-2KQX-7HMT-W4PD", { argon: FAST, spaceId: id });
  const claimed = await caller(printed.url, null)("identity.claim_owner", { code: decodeURIComponent(link.pathname.split("/").pop()!), spaceId: id, displayName: "Owner of B", username: "owner", password: "the owner of B's password", deviceName: "Mac", deviceClass: "desktop", keys: sendable(made as never) }) as { session: { token: string } };
  const stop = async (): Promise<void> => { if (child.exitCode !== null) return; const gone = new Promise((r) => child.once("exit", r)); child.kill("SIGTERM"); await gone; fs.rmSync(dir, { recursive: true, force: true }); };
  return { url: printed.url, token: claimed.session.token, dir, stop } as unknown as Daemon & { dir: string };
}

export async function invite(d: Daemon, email?: string): Promise<string> {
  const roles = (await ok(d, d.token, "access.roles.list")).roles as { id: string; name: string }[];
  const inv = await ok(d, d.token, "members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, ...(email ? { email } : {}) });
  return decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
}
/** A member as the invite page makes them, with a recovery code they kept. */
export async function joinWithNew(d: Daemon, username: string, code: string, email?: string): Promise<{ personId: string; token: string; personKey: Uint8Array; publicKey: string }> {
  const made = await makeBundle(PASSWORD, code, { argon: FAST, spaceId: await spaceOf(d) });
  const { personKey, ...rest } = made;
  const keys = { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
  const out = await accept(d, await invite(d, email), username, PASSWORD, keys);
  return { ...out, personKey, publicKey: rest.publicKey };
}
export async function accept(d: Daemon, code: string, username: string, password: string, keys: Record<string, unknown>): Promise<{ personId: string; token: string }> {
  const r = await api(d, null, "members.accept", { code, username, displayName: username, password, deviceName: "PC", deviceClass: "desktop", keys });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data as { personId: string; token: string };
}
export const sendable = (m: { personKeyByPassword: string; personKeyByRecovery: string; publicKey: string; privateKeyWrapped: string; spaceKeys: unknown[] }) =>
  ({ personKeyByPassword: m.personKeyByPassword, ...(m.personKeyByRecovery ? { personKeyByRecovery: m.personKeyByRecovery } : {}), publicKey: m.publicKey, privateKeyWrapped: m.privateKeyWrapped, spaceKeys: m.spaceKeys });

/** A real recovery in B with the code: identity.recovery_fetch, the sealed challenge opened by the code's key, identity.recovery_restore. */
export async function recoverIn(d: Daemon, username: string, code: string): Promise<Uint8Array> {
  const download = await caller(d, null)("identity.recovery_fetch", { username }) as Parameters<typeof recoverAccountKeys>[2];
  const r = await recoverAccountKeys(code, "a password after recovery", download, { argon: FAST });
  const out = await caller(d, null)("identity.recovery_restore", { username, recoveryProof: r.recoveryProof, newPassword: "a password after recovery", keys: r.keys, deviceName: "PC", deviceClass: "desktop" }) as { status: string };
  assert.equal(out.status, "ok");
  return r.personKey;
}

