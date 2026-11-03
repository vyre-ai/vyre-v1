// @heavy mac
// Claude Code on a person's own Mac, signed in through the Keychain (lane l-runson; owner decision D2): the device daemon reads the Keychain entry outside the sandbox and hands it to the engine as
// .credentials.json in a private config folder, and its access token in CLAUDE_CODE_OAUTH_TOKEN (host/src/compute/device-link.ts macClaude; the first run here showed Claude Code on a Mac does not
// read the file and answers "Not logged in"). Proved here with the real Claude Code under Vyre's exact Seatbelt profile (defaultSandbox + spawnCli and a
// wall of the process's own, as the engine module starts every CLI): it starts with CLAUDE_CONFIG_DIR and that file, and its model request carries the file's token as the bearer, at a fake
// endpoint reached only through the egress proxy (the way the D2 cred-check did on box B). A refresh the engine writes into the file goes back to the Keychain (here an in-memory stand-in: a
// runner's login Keychain is not the person's). Runs in the desktop workflow's sandbox leg (VYRE_HEAVY_MAC=1, VYRE_MAC_CLI_DIR).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { defaultSandbox } from "../sandbox-default.ts";
import type { DefaultSandbox } from "../sandbox-default.ts";
import { workFolder } from "../sandbox.ts";
import { spawnCli } from "../session.ts";
import { CLAUDE_KEYCHAIN, macClaude } from "../../../host/src/compute/device-link.ts";
import { createEgressProxy, RULE_ENV } from "../../../sandbox/src/index.ts";

const ON = process.platform === "darwin" && process.env["VYRE_HEAVY_MAC"] === "1";
const CLI_DIR = process.env["VYRE_MAC_CLI_DIR"];
const skip: string | false = !ON ? "needs a Mac and VYRE_HEAVY_MAC=1" : CLI_DIR ? false : "needs VYRE_MAC_CLI_DIR (Claude Code installed on the runner)";
const PERSON = "usr_01HZ0000000000000000000001";
const TOKEN = "sk-ant-oat01-FAKEACCESSTOKENforMacCheck0123456789"; // secret-scan: fake
const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mac-claude-signin-")));
let dflt: DefaultSandbox | undefined;
after(async () => { await dflt?.close(); fs.rmSync(data, { recursive: true, force: true }); });

test("the real Claude Code under the Seatbelt profile reads the Keychain sign-in handed over as a file and sends its token; a refresh goes back to the Keychain", { skip, timeout: 120_000 }, async () => {
  const seen: Array<{ method: string; url: string; auth: string }> = [];
  const up = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: String(req.headers["authorization"] ?? "") });
      if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; }
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "fake endpoint" } }));
    });
  });
  await new Promise<void>((ok) => up.listen(0, "127.0.0.1", ok));
  const upPort = (up.address() as net.AddressInfo).port;
  dflt = await defaultSandbox({ dataDir: data, programRead: [CLI_DIR as string] });
  assert.equal(dflt.plan.sandbox.kind, "seatbelt");
  const base = dflt.plan;
  const proxies: Array<{ close(): Promise<void> }> = [];
  // the turn's own wall, as the engine opens it; the vendor's name answers at the fake endpoint, through the proxy only
  const planned = {
    ...base,
    openWall: async (e: { allow: string[]; rule: never }) => {
      const px = createEgressProxy({ ...e, lookup: async () => ["203.0.113.40"], connect: async () => net.connect(upPort, "127.0.0.1") });
      proxies.push(px);
      const l = await px.listen();
      return { sandbox: { kind: "seatbelt" as const, proxyPort: l.port, ...(base.sandbox.kind === "seatbelt" && base.sandbox.programRead ? { programRead: base.sandbox.programRead } : {}) }, close: () => px.close() };
    },
  };
  const expiresAt = Date.now() + 30 * 86400_000;
  const cred = (t: string) => JSON.stringify({ claudeAiOauth: { accessToken: t, refreshToken: "sk-ant-ort01-FAKEREFRESH0123456789", expiresAt, scopes: ["user:inference", "user:profile"], subscriptionType: "max" } });   // secret-scan: fake
  const kc = new Map<string, string>([[CLAUDE_KEYCHAIN, cred(TOKEN)]]);
  const writes: string[] = [];
  const homes = { home: os.homedir(), env: {}, platform: "darwin" as const, exists: (p: string) => fs.existsSync(p), keychain: { read: (s: string) => kc.get(s) ?? null, write: (s: string, t: string) => { writes.push(t); kc.set(s, t); } } };
  const cwd = workFolder(data, PERSON, "prc_" + "e".repeat(24));
  const mac = macClaude({ CLAUDE_CODE_OAUTH_TOKEN: "sk-space-held-not-this-one" }, homes, data, PERSON, "prc_" + "e".repeat(24), 100);   // secret-scan: fake
  assert.ok(mac, "the Keychain entry was read");
  const exe = path.join(CLI_DIR as string, "node_modules", ".bin", "claude");
  const env = { ...mac!.env, ANTHROPIC_BASE_URL: "http://api.fake-vendor.test", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", [RULE_ENV]: JSON.stringify({ egress: "public" }) };
  const proc = await spawnCli(planned as never, { argv: [exe, "-p", "hello", "--output-format", "json"], cwd, env }, [exe, "-p", "hello", "--output-format", "json"]);
  let out = "";
  for await (const c of proc.stdout) out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
  const exit = await proc.exited;
  assert.equal(exit.signal, null, `Claude Code died on ${String(exit.signal)}: ${proc.stderrTail()}`);
  assert.doesNotMatch(proc.stderrTail(), /Operation not permitted|EPERM|SIGABRT/i, proc.stderrTail().slice(-600));
  const model = seen.filter((r) => r.method === "POST");
  assert.ok(model.length > 0, `a model request reached the fake endpoint: ${JSON.stringify(seen)}; said ${out.slice(-300)} ${proc.stderrTail().slice(-300)}`);
  assert.ok(model.every((r) => r.auth === `Bearer ${TOKEN}`), `it carried the Keychain sign-in's token as the bearer, not the Space's: ${JSON.stringify(model.map((r) => r.auth.slice(0, 30)))}`);
  // the engine refreshed its sign-in in place: it goes back to the Keychain
  fs.writeFileSync(path.join(mac!.env["CLAUDE_CONFIG_DIR"]!, ".credentials.json"), cred(`${TOKEN}-refreshed`));
  mac!.after();
  assert.deepEqual(writes, [cred(`${TOKEN}-refreshed`)]);
  for (const p of proxies) await p.close();
  up.close();
});
