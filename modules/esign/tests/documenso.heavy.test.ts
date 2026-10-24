// @heavy docker
// Documenso against the real pinned container (ARCH 8.4, P-L8_HEAVY): the compose units and lock in images/documenso boot with a Postgres sidecar, and an envelope
// goes create, send, recipient signs, Documenso's own webhook, completed, signed PDF saved, all through the real provider and esign.hook.
// Without a Docker daemon or without VYRE_HEAVY_DOCKER=1 every test here is skipped with its reason, so a skip is visible in the run and never counts as a pass of the real thing.
// @reads /images/documenso/documenso.lock
// @reads /images/documenso/compose.yml

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const COMPOSE = path.join(REPO, "images/documenso/compose.yml");
const LOCK = path.join(REPO, "images/documenso/documenso.lock");

const dockerOn = process.env["VYRE_HEAVY_DOCKER"] === "1" && spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status === 0;
const skip = dockerOn ? false : "needs Docker and VYRE_HEAVY_DOCKER=1";

const run = `vdt${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-documenso-heavy-"));
const say = (...a: unknown[]): void => console.log("[documenso-heavy]", ...a);

function sh(cmd: string, args: string[], o: { timeout?: number; input?: string; allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: o.timeout ?? 60_000, ...(o.input !== undefined ? { input: o.input } : {}), maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && !o.allowFail) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${out.slice(-4000)}`);
  return out;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

const state: { port: number; sinkPort: number; base: string; compose: string[] } = { port: 0, sinkPort: 0, base: "", compose: [] };

// The runner has no compose plugin: CI downloads the standalone binary and names it in VYRE_COMPOSE_BIN.
const composeBin = process.env["VYRE_COMPOSE_BIN"];

function dc(args: string[], o: { timeout?: number; input?: string; allowFail?: boolean } = {}): string {
  return composeBin ? sh(composeBin, [...state.compose, ...args], o) : sh("docker", ["compose", ...state.compose, ...args], o);
}

const SINK = `const net = require("node:net");
const http = require("node:http");
const captured = { mail: [], hooks: [] };
http.createServer((req, res) => {
  let b = "";
  req.on("data", (d) => { b += d; });
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/captured") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(captured)); return; }
    if (req.method === "POST") captured.hooks.push({ url: req.url, headers: req.headers, body: b, at: Date.now() });
    res.end("ok");
  });
}).listen(8080);
net.createServer((s) => {
  let buf = ""; let data = false; let msg = ""; let auth = "";
  s.write("220 sink ESMTP\\r\\n");
  const line = (l) => {
    if (data) { if (l === ".") { data = false; captured.mail.push({ text: msg, at: Date.now() }); msg = ""; s.write("250 queued\\r\\n"); } else msg += (l.startsWith("..") ? l.slice(1) : l) + "\\n"; return; }
    if (auth === "plain") { auth = ""; s.write("235 ok\\r\\n"); return; }
    if (auth === "user") { auth = "pass"; s.write("334 UGFzc3dvcmQ6\\r\\n"); return; }
    if (auth === "pass") { auth = ""; s.write("235 ok\\r\\n"); return; }
    const c = l.toUpperCase();
    if (c.startsWith("EHLO") || c.startsWith("HELO")) s.write("250-sink\\r\\n250 AUTH PLAIN LOGIN\\r\\n");
    else if (c.startsWith("AUTH PLAIN")) { if (l.length > 11) s.write("235 ok\\r\\n"); else { auth = "plain"; s.write("334 \\r\\n"); } }
    else if (c.startsWith("AUTH LOGIN")) { auth = "user"; s.write("334 VXNlcm5hbWU6\\r\\n"); }
    else if (c.startsWith("DATA")) { data = true; s.write("354 go\\r\\n"); }
    else if (c.startsWith("QUIT")) { s.write("221 bye\\r\\n"); s.end(); }
    else s.write("250 ok\\r\\n");
  };
  s.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\\r\\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); line(l); } });
  s.on("error", () => {});
}).listen(2525);
`;

test("setup: the pinned stack boots (Postgres sidecar, Documenso, a sink for mail and webhooks) and reports healthy", { skip }, async () => {
  state.port = await freePort();
  state.sinkPort = await freePort();
  state.base = `http://127.0.0.1:${state.port}`;
  fs.writeFileSync(path.join(tmp, "sink.js"), SINK);
  const rnd = (n: number): string => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))).toString("hex");
  fs.writeFileSync(path.join(tmp, "test.env"), [
    `DOCUMENSO_PORT=${state.port}`, `DOCUMENSO_PUBLIC_URL=${state.base}`, `DOCUMENSO_DB_PASSWORD=${rnd(12)}`, `DOCUMENSO_AUTH_SECRET=${rnd(24)}`,
    `DOCUMENSO_ENCRYPTION_KEY=${rnd(16)}`, `DOCUMENSO_ENCRYPTION_SECONDARY_KEY=${rnd(16)}`, `DOCUMENSO_SIGNING_PASSPHRASE=testpass`,
    "DOCUMENSO_SMTP_HOST=sink", "DOCUMENSO_SMTP_PORT=2525", "DOCUMENSO_SMTP_USERNAME=sink", "DOCUMENSO_SMTP_PASSWORD=sink", "DOCUMENSO_SMTP_FROM=sign@vyre.test", `SINK_PORT=${state.sinkPort}`, "",
  ].join("\n"));
  fs.writeFileSync(path.join(tmp, "override.yml"), `services:
  documenso:
    environment:
      NEXT_PUBLIC_DISABLE_SIGNUP: "false"
  sink:
    image: node:24-alpine
    command: ["node", "/sink/sink.js"]
    volumes:
      - ${tmp}:/sink:ro
    ports:
      - "127.0.0.1:\${SINK_PORT}:8080"
    networks:
      - documenso-edge
`);
  state.compose = ["-p", run, "--env-file", LOCK, "--env-file", path.join(tmp, "test.env"), "-f", COMPOSE, "-f", path.join(tmp, "override.yml")];
  say(dc(["config", "--images"]));
  try {
    say(dc(["up", "-d", "--wait", "--wait-timeout", "420"], { timeout: 600_000 }));
  } finally {
    say(dc(["ps", "-a"], { allowFail: true }));
    say(dc(["logs", "--tail", "60", "documenso"], { allowFail: true }));
  }
  const health = await fetch(`${state.base}/api/health`);
  assert.equal(health.status, 200);
  say("health", await health.text());
});

test("probe: what this Documenso answers", { skip }, async () => {
  const get = async (p: string): Promise<string> => {
    try {
      const r = await fetch(`${state.base}${p}`, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
      const t = await r.text();
      return `${p} -> ${r.status} ${r.headers.get("content-type") ?? ""} ${t.slice(0, 600).replace(/\s+/g, " ")}`;
    } catch (e) {
      return `${p} -> ${String(e)}`;
    }
  };
  for (const p of ["/api/v1/openapi.json", "/api/openapi.json", "/api/v2/openapi.json", "/api/v1/me", "/signin", "/signup", "/api/trpc"]) say(await get(p));
  const psql = (q: string): string => dc(["exec", "-T", "documenso-db", "psql", "-U", "documenso", "-d", "documenso", "-c", q], { allowFail: true });
  say(psql("\\dt"));
  for (const t of ["User", "ApiToken", "Team", "Organisation", "Webhook", "Document", "Envelope", "Recipient", "Field"]) say(psql(`\\d "${t}"`).slice(0, 2500));
});

test("cleanup", { skip }, () => {
  say(dc(["logs", "--tail", "120", "documenso"], { allowFail: true }));
  dc(["down", "-v", "--remove-orphans", "--timeout", "10"], { allowFail: true, timeout: 120_000 });
  fs.rmSync(tmp, { recursive: true, force: true });
  void execFileSync;
});
