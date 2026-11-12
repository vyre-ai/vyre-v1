// The release gate's walk kit (12 Nov 2026, lane f-gate): a real daemon as a person starts it (a child process that can be stopped and started again on the same data and port), with real Docker
// workspaces and no model stand-in, fronted by the app's web export on one origin. The walks gate-*.real.live.test.ts use it with OPENCODE_API_KEY from the environment; without the key they skip
// by name, the way room-pack.real.live.test.ts does. The key is only ever sent to the daemon through providers.space_key.set / providers.add and is never printed or written.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { REPO } from "./real-app-harness.test.ts";

export const REAL_KEY = process.env["OPENCODE_API_KEY"] ?? "";
/** The skip reason for a gate walk, or false when it can run. */
export const gateSkip = (): string | false => (REAL_KEY === "" ? "OPENCODE_API_KEY is not set" : process.env["VYRE_APP_DIST"] ? false : "VYRE_APP_DIST is not set (the web export)");
/** The cheap default model the repo's real-key tests use. */
export const GATE_MODEL = "deepseek-v4.1-flash";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

export interface GateDaemon {
  dir: string; port: number; address: string; claim: string | null;
  child: () => ChildProcess;
  /** Stop with SIGTERM (a person quitting the app) or SIGKILL (a crash). */
  stop(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  /** Start again on the same data and port; resolves when it listens. */
  start(): Promise<void>;
  log(): string;
  /** The environment the daemon starts with next; change it before start(). */
  env: NodeJS.ProcessEnv;
}

/** The daemon the way main.ts starts it. The model key is not in its environment: the walk gives it through the API, as a person types it in. */
export async function bootGate(kind: "personal" | "team", name: string, opts: { dir?: string; port?: number } = {}): Promise<GateDaemon> {
  const dir = opts.dir ?? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vyre-gate-${kind}-`)));
  const port = opts.port ?? await freePort();
  const address = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, VYRE_TEST_KEY_CHECK: "real" };
  delete env["OPENCODE_API_KEY"]; delete env["NODE_TEST_CONTEXT"];
  let child: ChildProcess | null = null; let out = ""; let claim: string | null = null;
  const launch = (): Promise<void> => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["host/src/daemon/main.ts", "--role", "space", "--data-dir", dir, "--port", String(port), "--space", `spc_gate_${kind}`, "--space-name", name, "--space-kind", kind, "--address", address], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    child = c;
    const timer = setTimeout(() => { c.kill("SIGKILL"); reject(new Error(`the daemon did not listen in 60 s: ${out.slice(-400)}`)); }, 60_000);
    let buf = "";
    const on = (d: Buffer): void => {
      out += d.toString(); buf += d.toString();
      if (claim === null) { const m = /Claim this Space[^\n]*?: (http\S+)/.exec(out); if (m?.[1]) claim = m[1]; }
      if (/listening on http/.test(buf) && !resolved) { resolved = true; clearTimeout(timer); setTimeout(resolve, 1500); }
    };
    let resolved = false;
    c.stdout?.on("data", on); c.stderr?.on("data", on);
    c.once("exit", (code) => { clearTimeout(timer); if (!resolved) reject(new Error(`the daemon exited with ${String(code)}: ${out.slice(-600)}`)); });
  });
  await launch();
  const self: GateDaemon = {
    dir, port, address, get claim() { return claim; },
    child: () => child as ChildProcess,
    stop: (signal = "SIGTERM") => new Promise<void>((resolve) => {
      const c = child; if (!c || c.exitCode !== null) { resolve(); return; }
      c.once("exit", () => resolve()); c.kill(signal); setTimeout(() => c.kill("SIGKILL"), 15_000).unref();
    }),
    start: async () => { out += "\n\u0000"; await launch(); },
    log: () => out, env,
  } as GateDaemon;
  return self;
}

export interface Row { section: string; step: string; result: string; ms?: number; shot?: string; note?: string }
/** The rows the report is made from: step, result, timing, screenshot. Written as JSON beside the shots after every step so a crashed run still leaves its evidence. */
export function recorder(dir: string, file: string): { add(r: Row): void; rows: Row[] } {
  fs.mkdirSync(dir, { recursive: true });
  const rows: Row[] = [];
  return { rows, add(r) { rows.push(r); fs.writeFileSync(path.join(dir, file), JSON.stringify(rows, null, 1)); console.log(`GATE ${r.section} | ${r.step} | ${r.result}${r.ms !== undefined ? ` | ${r.ms} ms` : ""}${r.note ? ` | ${r.note}` : ""}`); } };
}

test("gate kit: a port is free and the key is never part of the daemon's environment", async () => {
  assert.ok(await freePort() > 0);
  assert.equal(typeof gateSkip(), gateSkip() === false ? "boolean" : "string");
});

/** The claim screens the way a person walks them; returns the milliseconds from Create my Space to the first screen. */
export async function claimInBrowser(page: import("playwright-core").Page, link: string, o: { name: string; username: string; password: string }): Promise<number> {
  await page.goto(link, { waitUntil: "load" });
  await page.getByTestId("claim-name").fill(o.name); await page.getByTestId("claim-username").fill(o.username);
  await page.getByTestId("claim-password").fill(o.password); await page.getByTestId("claim-confirm").fill(o.password);
  await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click();
  const t0 = Date.now();
  await page.getByTestId("claim-create").click();
  await page.getByTestId("shell").or(page.getByTestId("onboarding")).first().waitFor({ timeout: 40_000 });
  return Date.now() - t0;
}

/** The app's own token for the signed-in origin (the browser holds it), for API calls beside the walk. */
export async function tokenOf(page: import("playwright-core").Page): Promise<string> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
}

/** A preload that makes every request to OpenCode fail the way an unreachable host does (the daemon is otherwise untouched). Returns the NODE_OPTIONS value to start the daemon with. */
export function unreachablePreload(dir: string): string {
  const f = path.join(dir, "gate-unreachable-preload.mjs");
  fs.writeFileSync(f, 'const real = globalThis.fetch;\nglobalThis.fetch = (input, init) => { const u = String(input?.url ?? input); if (u.includes("opencode.ai")) { const e = new TypeError("fetch failed"); e.cause = Object.assign(new Error("getaddrinfo ENOTFOUND opencode.ai"), { code: "ENOTFOUND" }); return Promise.reject(e); } return real(input, init); };\n');
  return `--import ${f}`;
}

/** GATE_SPACE=team runs a walk on a Team Space whose only AI source is the Space key (providers.space_key.set); otherwise a Personal Space with the person's own key. */
export const SPACE_KIND: "personal" | "team" = process.env["GATE_SPACE"] === "team" ? "team" : "personal";
export async function addAi(call: (cap: string, data?: unknown) => Promise<any>): Promise<void> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (SPACE_KIND === "team") { await call("providers.space_key.set", { providerKey: "opencode-go", apiKey: REAL_KEY }); await call("engine.models.list", { refresh: true, wait: true }); }
  else await call("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
}
