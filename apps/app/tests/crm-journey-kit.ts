// The pieces the CRM-to-Records journeys share (apps/app/tests/crm.journeys.live.test.ts): a daemon started in this process the way a person's computer or a Team server runs it, the app's
// production export on one origin (when CI has built it), a fake CRM behind the connector network seam (a real HTTP server, the Link header and webhooks included), and screenshots at every step
// in light and dark, desktop and phone. Nothing in the daemon is faked except the outside app (the fake CRM). The agent's part is proven by test/crm-to-records.test.ts and the real run.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import { KEY_A, KEY_B } from "../../../modules/connectors/fixtures/crm.ts";
import { startFakeCrm } from "../../../test/support/fake-crm-server.ts";
import type { FakeCrm } from "../../../test/support/fake-crm-server.ts";
import { edge } from "./real-app-harness.test.ts";
import type { Edge } from "./real-app-harness.test.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const KEY_TEXT = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

export interface Space { /** What the Vault hands out for a handle: a test changes it to revoke a key. */ keys: Record<string, string>; d: Daemon; dir: string; web: Edge | null; crm: FakeCrm; stop(): Promise<void> }

export async function startSpace(o: { kind: "personal" | "team"; name: string; address?: string }): Promise<Space> {
  const dist = process.env["VYRE_APP_DIST"] ?? "";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-crm-journey-${o.kind}-`));
  const crm = await startFakeCrm();
  const keys: Record<string, string> = { Ledger: KEY_A, Orbit: KEY_B };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", `spc_crm_${o.kind}`, "--space-name", o.name, "--space-kind", o.kind, ...(o.address ? ["--address", o.address] : [])], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: `crm-${o.kind}`, free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    connectorNetwork: { resolve: async () => ["93.184.216.34"], request: async (url, req) => { const r = await crm.fetch(url.toString(), { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}) }); return { status: r.status, text: await r.text(), ...(r.link ? { link: r.link } : {}) }; } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async (handle: string) => keys[Object.keys(keys).find((k) => handle.includes(k)) ?? ""] ?? KEY_TEXT, signRs256: async () => "" },
  });
  // the browser part needs the app's export (CI builds it); the rest of a journey runs without it
  const web = dist ? await edge(dist, d.url) : null;
  return { keys, d, dir, web, crm, stop: async () => { web?.close(); await d.stop(); await crm.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** A capability over HTTP as the owner (the same door the CLI and the Console use). */
export async function api(s: Space, cap: string, input: Record<string, unknown> = {}, token = s.d.token): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${s.d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `j-${cap}-${Math.random().toString(36).slice(2)}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
export async function ok(s: Space, cap: string, input: Record<string, unknown> = {}, token?: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(s, cap, input, token);
  if (r.status !== 200) throw new Error(`${cap}: ${JSON.stringify(r.data).slice(0, 300)}\n${hostErrors(s.d).slice(0, 1500)}`);
  return r.data;
}

// ---- screenshots

export interface Shots { dir: string; n: number; take(page: Pg, name: string): Promise<void> }
interface Pg { screenshot(o: { path: string }): Promise<unknown>; setViewportSize(s: { width: number; height: number }): Promise<void>; emulateMedia(o: { colorScheme: "light" | "dark" }): Promise<void>; waitForTimeout(ms: number): Promise<void> }

/** One step, four pictures: desktop light and dark, phone light and dark. The page is put back where it was. */
export function shots(dir: string, journey: string): Shots {
  const out = path.join(dir, journey);
  fs.mkdirSync(out, { recursive: true });
  const s: Shots = { dir: out, n: 0, async take(page, name) {
    s.n++;
    const label = `${String(s.n).padStart(2, "0")}-${name}`;
    for (const [vp, w, h] of [["desktop", 1280, 800], ["phone", 390, 780]] as const) for (const mode of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(out, `${label}-${vp}-${mode}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(250);
  } };
  return s;
}

export function hostErrors(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 40 AND msg NOT LIKE '%grants on an agent%' AND msg NOT LIKE '%neighbour%' ORDER BY id DESC LIMIT 20").all() as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[];
  return rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 200)}`).join("\n");
}

/** The Vault, unlocked as the owner does in Settings, with the CRM's key in a Shared folder so the Space can use it. Returns the handle a spec names. */
export async function vaultKey(s: Space, app: "Ledger" | "Orbit"): Promise<string> {
  const unlock = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  if (unlock.status !== 204 && unlock.status !== 409) throw new Error(`unlock ${unlock.status}`);
  const folder = (await ok(s, "vault.folders.create", { name: `${app} keys`, scope: "shared" })).folder.id as string;
  const item = (await ok(s, "vault.item.put", { folderId: folder, name: `${app} Key`, kind: "api_key", fields: [{ key: "api_key", value: s.keys[app], secret: true }] })).item as { handle: string };
  return item.handle;
}

/** Waits until a check holds; the message names what never happened. */
export async function until(what: string, check: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await sleep(150); }
  throw new Error(`never happened: ${what}`);
}

/** A spec with the Vault handle the key really has. */
export function withHandle(spec: Record<string, unknown>, handle: string): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(spec)) as { auth: { vaultHandle: string } };
  out.auth.vaultHandle = handle;
  return out as unknown as Record<string, unknown>;
}
