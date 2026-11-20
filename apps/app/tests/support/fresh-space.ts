// The booted-daemon helpers the real-app tests and the fresh-Space guard share: start the daemon as a person does, and make a fresh Space (an empty data directory, claim link printed). Not a test file: importing it
// registers no tests (real-app-harness.test.ts re-exports these for the files that already import them from there).
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../../..", import.meta.url));

export const ADMIN_TOKEN = "e2e-owner-bootstrap-token";
/** The fixture Space's id. VYRE_FIXTURE_SPACE_ID gives it a minted-shaped one (spc_ and 32 hex), so a walk can prove a screen shows no real id. */
const SPACE_ID = process.env["VYRE_FIXTURE_SPACE_ID"] ?? "spc_fresh";

export interface Space {
  url: string;
  token: string;
  space: string;
  dir: string;
  stop(): Promise<void>;
  /** The one-time owner claim link the daemon printed (fresh installs only), or null. */ claim: string | null;
}

export const stopper =
  (child: ChildProcess): (() => Promise<void>) =>
  () =>
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    });

/** Starts the daemon as a person does and reads the address it prints (and, on a fresh install, the claim link it prints right after). */
/** What a walk's daemon is given besides the owner token: a stand-in model vendor (an address, a preload, a way to close it). The helper imports no fixture, so a test file hands it in. */
export interface VendorStandIn {
  env: NodeJS.ProcessEnv;
  close(): void;
}
export type MakeStandIn = () => Promise<VendorStandIn | null>;

export async function startDaemon(
  dir: string,
  extra: string[],
  port = 0,
  makeStandIn?: MakeStandIn,
): Promise<{ child: ChildProcess; url: string; claim: string | null }> {
  // A key is checked with its provider before it is saved, so a walk that adds a fixture key needs a provider that answers: the test file that starts the daemon hands in the shared stand-in (accepts keys,
  // refuses one with "invalid" in it) unless it brought its own (VYRE_TEST_VENDOR) or opted out (VYRE_TEST_NO_VENDOR=1, for a walk that wants the real provider's answer).
  let env: NodeJS.ProcessEnv = { ...process.env, VYRE_ADMIN_TOKEN: ADMIN_TOKEN };
  let standIn: { close(): void } | null = null;
  if (makeStandIn && !process.env["VYRE_TEST_VENDOR"] && process.env["VYRE_TEST_NO_VENDOR"] !== "1") {
    const v = await makeStandIn();
    if (v) {
      standIn = v;
      env = { ...env, ...v.env };
    }
  }
  const child: ChildProcess = spawn(
    process.execPath,
    ["host/src/daemon/main.ts", "--role", "space", "--data-dir", dir, "--port", String(port), ...extra],
    {
      cwd: REPO,
      env,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  child.once("exit", () => standIn?.close());
  const printed = await new Promise<{ url: string; claim: string | null }>((resolve, reject) => {
    let out = "";
    let url: string | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`the daemon did not start in 30 s: ${out}`));
    }, 30_000); // a daemon that never came up must not outlive the failed boot
    const done = (): void => {
      clearTimeout(timer);
      if (settle) clearTimeout(settle);
      resolve({ url: url ?? "", claim: /Claim this Space[^\n]*?: (http\S+)/.exec(out)?.[1] ?? null });
    };
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      if (!url) {
        const m = /listening on (http\S+)/.exec(out);
        if (m?.[1]) {
          url = m[1];
          settle = setTimeout(done, 2000);
        } // the claim line follows at once on a fresh install; a seeded Space prints none
      }
      if (url && /Claim this Space[^\n]*?: http\S+/.test(out)) done();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the daemon exited with ${String(code)}: ${out}`));
    });
  });
  return { child, ...printed };
}

/** A fresh install (ruling 71): an empty data directory. The host makes the Space and prints a one-time claim link; the owner becomes the owner by claiming it, as a person does. */
export async function bootFreshSpace(
  kind?: "personal",
  publishLocal = false,
  unnamed = false,
  makeStandIn?: MakeStandIn,
): Promise<Space> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-real-app-fresh-"));
  // A walk that publishes the daemon's own address needs the port before the daemon starts, and the daemon binds it itself, so a port picked and given back can be taken in between. When that happens the daemon exits
  // (or never starts) and the boot is tried again on another port; whatever a failed try started is stopped first.
  for (let attempt = 1; ; attempt++) {
    const port = publishLocal
      ? await new Promise<number>((resolve, reject) => {
          const server = net.createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const selected = (server.address() as net.AddressInfo).port;
            server.close(() => resolve(selected));
          });
        })
      : 0;
    const address = publishLocal ? `http://127.0.0.1:${port}` : null;
    try {
      const d = await startDaemon(
        dir,
        [
          "--space",
          SPACE_ID,
          ...(unnamed ? [] : ["--space-name", kind === "personal" ? "Personal" : "Fresh Co"]),
          ...(kind ? ["--space-kind", kind] : []),
          ...(address ? ["--address", address] : []),
        ],
        port,
        makeStandIn,
      );
      if (address && d.url !== address) {
        d.child.kill("SIGKILL");
        throw new Error("The fixture must publish its actual listening endpoint");
      }
      return { url: d.url, token: ADMIN_TOKEN, space: SPACE_ID, dir, stop: stopper(d.child), claim: d.claim };
    } catch (e) {
      if (!publishLocal || attempt >= 4) throw e;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
