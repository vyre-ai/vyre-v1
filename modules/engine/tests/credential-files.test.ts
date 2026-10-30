// Sign-in files for a CLI engine that signs in with files (Codex, Grok): checked, placed 0600 in the engine's own home for the life of its process, removed after, never in the environment the engine gets, and read by
// stand-in CLIs through the real launcher path. The sandbox wrap is replaced by one that sets the home the way the Seatbelt profile does (HOME, CODEX_HOME), because these run on any machine.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CRED_FILES_ENV, CredentialFilesError, engineHome, parseCredentialFiles, placeCredentialFiles, takeCredentialFiles } from "../credential-files.ts";
import { spawnCli } from "../session.ts";
import { workFolder } from "../sandbox.ts";
import type { SandboxPlan } from "../sandbox.ts";
import { cliCredential } from "../../../agent/src/drivers/open/credentials.ts";
import { credentialLeaves } from "../../../agent/src/drivers/open/fill-launcher.ts";

const STAND_IN = fileURLToPath(new URL("../../../host/tests/fixtures/fake-cli-driver/fake-signin-cli.mjs", import.meta.url));
const ACCESS = "codex-access-token-LIVE-0123456789abcdef"; // secret-scan: fake
const GROK = "grok-session-token-LIVE-0123456789abcdef"; // secret-scan: fake
const CODEX_FILES = JSON.stringify({ ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: null, tokens: { access_token: ACCESS, refresh_token: "refresh-token-LIVE-0123456789", id_token: "a.b.c" } }) });
const GROK_FILES = JSON.stringify({ ".grok/auth.json": JSON.stringify({ token: GROK }) });

function plan(): { dir: string; plan: SandboxPlan; cwd: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-credfiles-")));
  const cwd = workFolder(dir, "usr_dana", "thr_1");
  return { dir, cwd, plan: { sandbox: { kind: "seatbelt", proxyPort: 1 }, dataDir: dir, egressHosts: [] } };
}

/** The wrap the Seatbelt profile makes: the engine's own home and CODEX_HOME in front of the command. */
const wrapOf = (p: SandboxPlan): ((argv: readonly string[], start: { env: Readonly<Record<string, string>>; cwd?: string }) => readonly string[]) => (argv, start) => {
  const home = engineHome(p.dataDir, start.cwd!);
  return ["/usr/bin/env", `HOME=${home}`, `CODEX_HOME=${path.join(home, ".codex")}`, process.execPath, STAND_IN, ...argv];
};

async function run(cli: "codex" | "grok", files: string | undefined, prompt: string, over: { onSpawn?(): void } = {}): Promise<{ text: string; stderr: string; cwd: string; dir: string; exited: Promise<unknown>; env: Record<string, string> }> {
  const w = plan();
  const env: Record<string, string> = { ...(files !== undefined ? { [CRED_FILES_ENV]: files } : {}), VYRE_MCP_TOKEN: "vys_mcp_token_0123456789" };
  const proc = await spawnCli(w.plan, { argv: [cli], env, cwd: w.cwd }, [cli], { wrapOf });
  over.onSpawn?.();
  proc.write(prompt);
  proc.endInput();
  let text = "";
  for await (const c of proc.stdout) text += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
  await proc.exited;
  await new Promise((r) => setTimeout(r, 50));
  return { text, stderr: proc.stderrTail(), cwd: w.cwd, dir: w.dir, exited: proc.exited, env };
}

test("a file map is checked: relative paths in the home, a few small files, nothing that climbs", () => {
  assert.deepEqual(parseCredentialFiles(CODEX_FILES), JSON.parse(CODEX_FILES));
  for (const bad of ["", "[]", "null", "{}", JSON.stringify({ "../x": "a" }), JSON.stringify({ "/etc/x": "a" }), JSON.stringify({ "a//b": "a" }), JSON.stringify({ ok: 5 }), JSON.stringify({ big: "x".repeat(70_000) }), JSON.stringify({ "a\0b": "x" })]) {
    assert.throws(() => parseCredentialFiles(bad), CredentialFilesError, bad.slice(0, 30));
  }
});

test("the files come out of the environment and the codex and grok subscriptions are filled into VYRE_CRED_FILES", () => {
  assert.deepEqual(takeCredentialFiles({ A: "1", [CRED_FILES_ENV]: "x" }), { env: { A: "1" }, files: "x" });
  assert.deepEqual(takeCredentialFiles({ A: "1" }), { env: { A: "1" }, files: undefined });
  assert.deepEqual(cliCredential("codex", "subscription", "#Dana_Codex"), { env: CRED_FILES_ENV, handle: "#Dana_Codex.credentials" });
  assert.deepEqual(cliCredential("grok", "subscription", "#Dana_Grok"), { env: CRED_FILES_ENV, handle: "#Dana_Grok.credentials" });
  assert.deepEqual(cliCredential("codex", "api_key", "#K"), { env: "CODEX_API_KEY", handle: "#K" });
});

test("every long string in the files is a secret the scrubber knows, inside the files too", () => {
  const leaves = credentialLeaves(CODEX_FILES);
  assert.ok(leaves.includes(ACCESS));
  assert.ok(leaves.includes("refresh-token-LIVE-0123456789"));
  assert.equal(leaves.some((l) => l.includes("{")), false, "the file text and the map are not secrets of their own");
  assert.deepEqual(credentialLeaves("not json"), []);
});

test("placing writes 0600 files in 0700 folders in the engine's home, and release overwrites and removes them", () => {
  const w = plan();
  const placed = placeCredentialFiles(w.dir, w.cwd, CODEX_FILES);
  const f = path.join(placed.home, ".codex", "auth.json");
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), "600");
  assert.equal((fs.statSync(path.dirname(f)).mode & 0o777).toString(8), "700");
  assert.equal(fs.readFileSync(f, "utf8").includes(ACCESS), true);
  placed.release();
  assert.equal(fs.existsSync(f), false);
  placed.release();
  assert.throws(() => placeCredentialFiles(w.dir, path.join(w.dir, "elsewhere"), CODEX_FILES), /./);
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test("a Codex turn reads its sign-in from CODEX_HOME: the file is 0600, the token is not in the environment, and the files are gone when it ends", async () => {
  const r = await run("codex", CODEX_FILES, "authcheck");
  const reply = JSON.parse(r.text.split("\n").find((l) => l.includes("agent_message"))!) as { item: { text: string } };
  const expected = (await import("node:crypto")).createHash("sha256").update(ACCESS).digest("hex").slice(0, 10);
  assert.equal(reply.item.text, `codex signed in as ${expected} mode 600 env none`);
  assert.equal(r.text.includes(ACCESS), false, "the stand-in never prints the token");
  assert.equal(fs.existsSync(path.join(engineHome(r.dir, r.cwd), ".codex", "auth.json")), false, "removed after the turn");
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("a Grok turn reads its sign-in from its home, and the files are gone when it ends", async () => {
  const r = await run("grok", GROK_FILES, "authcheck");
  const result = JSON.parse(r.text.split("\n").find((l) => l.includes('"type":"result"'))!) as { result: string };
  const expected = (await import("node:crypto")).createHash("sha256").update(GROK).digest("hex").slice(0, 10);
  assert.equal(result.result, `grok signed in as ${expected} mode 600 env none`);
  assert.equal(fs.existsSync(path.join(engineHome(r.dir, r.cwd), ".grok", "auth.json")), false);
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("with no sign-in files the engine finds none, and a broken file map stops the turn before anything starts", async () => {
  const none = await run("codex", undefined, "authcheck");
  assert.match(none.text, /codex has no sign-in files/);
  fs.rmSync(none.dir, { recursive: true, force: true });
  const w = plan();
  await assert.rejects(() => spawnCli(w.plan, { argv: ["codex"], env: { [CRED_FILES_ENV]: "{\"../x\":\"a\"}" }, cwd: w.cwd }, ["codex"], { wrapOf }), (e: { code?: string }) => e.code === "engine.account_unavailable");
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test("a process that fails to start leaves no file behind", async () => {
  const w = plan();
  await assert.rejects(() => spawnCli(w.plan, { argv: ["codex"], env: { [CRED_FILES_ENV]: CODEX_FILES }, cwd: w.cwd }, ["codex"], { wrapOf: () => () => ["/nonexistent/program"] }));
  assert.equal(fs.existsSync(path.join(engineHome(w.dir, w.cwd), ".codex", "auth.json")), false);
  fs.rmSync(w.dir, { recursive: true, force: true });
});
