// @ts-check
// The native messaging host `run.vyre.bridge`: Chrome starts this program when the extension connects, and it relays between Chrome's
// stdio framing (framing.js) and the local vyred device daemon's Chrome bridge over loopback HTTP with the daemon's local admin token.
//
//   extension -> host   one framed JSON request          host -> daemon  POST {daemon}/chrome-bridge/v1/rpc            (one request, one JSON reply)
//   host -> extension   the daemon's reply, framed       daemon -> host  GET  {daemon}/chrome-bridge/v1/events         (newline-delimited JSON pushes)
//
// The daemon address and token come from the data directory's vyred.json and admin.token, found the same way the CLI finds them.
// Nothing is logged: stdout belongs to Chrome, and stderr gets error codes only, never a request or a value.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecoder, encode } from "../framing.js";

/** Where a vyred data directory may be, in the order a person's own setting wins. @param {NodeJS.ProcessEnv} env */
export function dataDirs(env) {
  const home = os.homedir();
  /** @type {string[]} */
  const dirs = [];
  if (env["VYRE_DATA_DIR"]) dirs.push(env["VYRE_DATA_DIR"]);
  dirs.push(path.join(home, ".vyre"));
  dirs.push(path.join(home, "Library", "Application Support", "ai.vyre.desktop", "vyred"));
  if (env["APPDATA"]) dirs.push(path.join(env["APPDATA"], "ai.vyre.desktop", "vyred"));
  dirs.push(path.join(env["XDG_DATA_HOME"] || path.join(home, ".local", "share"), "ai.vyre.desktop", "vyred"));
  return dirs;
}

/**
 * The running device daemon: its loopback URL and admin token, or null when none is running.
 * @param {string[]} dirs @param {(pid: number) => boolean} [alive]
 * @returns {{ url: string, token: string } | null}
 */
export function findDaemon(dirs, alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e).code === "EPERM"; } }) {
  for (const dir of dirs) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, "vyred.json"), "utf8"));
      if (!info || typeof info.url !== "string" || !alive(Number(info.pid))) continue;
      const u = new URL(info.url);
      if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) continue;
      const token = fs.readFileSync(path.join(dir, "admin.token"), "utf8").trim();
      if (token) return { url: u.origin, token };
    } catch { /* not this directory */ }
  }
  return null;
}

/**
 * One JSON request to the daemon. @param {{ url: string, token: string }} daemon @param {string} pathname @param {unknown} body
 * @returns {Promise<any>}
 */
export function rpc(daemon, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(new URL(pathname, daemon.url), { method: "POST", headers: { "content-type": "application/json", "content-length": payload.length, authorization: `Bearer ${daemon.token}` } }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("bad_reply")); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}

/**
 * Run the relay until stdin closes. `onError` gets codes only.
 * @param {{ stdin: NodeJS.ReadableStream, stdout: { write(b: Buffer): any }, daemon: { url: string, token: string } | null, onError?: (code: string) => void }} io
 * @returns {Promise<void>}
 */
export function runHost({ stdin, stdout, daemon, onError = () => {} }) {
  /** @param {unknown} m */
  const send = (m) => { try { stdout.write(encode(m)); } catch { onError("write"); } };
  /** @param {string} id @param {string} code @param {string} message */
  const fail = (id, code, message) => send({ id, ok: false, error: { code, message } });
  const decoder = createDecoder();
  /** @type {import("node:http").ClientRequest | null} */
  let events = null;

  if (daemon) {
    events = http.request(new URL("/chrome-bridge/v1/events", daemon.url), { method: "GET", headers: { authorization: `Bearer ${daemon.token}` } }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let at;
        while ((at = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, at).trim();
          buf = buf.slice(at + 1);
          if (!line) continue;
          try { send(JSON.parse(line)); } catch { onError("bad_event"); }
        }
      });
    });
    events.on("error", () => onError("events"));
    events.end();
  }

  return new Promise((resolve) => {
    stdin.on("data", (chunk) => {
      /** @type {unknown[]} */
      let messages;
      try { messages = decoder.push(/** @type {Buffer} */ (chunk)); } catch { onError("framing"); resolve(); return; }
      for (const m of messages) {
        const id = m && typeof m === "object" && typeof (/** @type {any} */ (m)).id === "string" ? (/** @type {any} */ (m)).id : "";
        if (!daemon) { fail(id, "offline", "The Vyre app is not running."); continue; }
        rpc(daemon, "/chrome-bridge/v1/rpc", m).then((reply) => send(reply), () => fail(id, "offline", "The Vyre app did not answer."));
      }
    });
    stdin.on("end", () => { events?.destroy(); resolve(); });
    stdin.on("close", () => { events?.destroy(); resolve(); });
  });
}

/** The caller Chrome names in argv[2]: a browser extension origin, or nothing. @param {string[]} argv */
export function callerOk(argv) {
  const origin = argv[2];
  return origin === undefined || /^(chrome|moz)-extension:\/\/[a-z0-9-]+\/?$/.test(origin);
}

// Run as the program Chrome starts (node host.js <origin>), not when a test imports it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!callerOk(process.argv)) process.exit(2);
  void runHost({ stdin: process.stdin, stdout: process.stdout, daemon: findDaemon(dataDirs(process.env)), onError: (code) => process.stderr.write(`bridge host: ${code}\n`) }).then(() => process.exit(0));
}
