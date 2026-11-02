// Sign-in files for a CLI engine that signs in with files (Codex, Grok): checked, placed 0600 in the engine's own home for the life of its process, removed after, never in the environment the engine gets, and read by
// stand-in CLIs through the real launcher path. The sandbox wrap is replaced by one that sets the home the way the Seatbelt profile does (HOME, CODEX_HOME), because these run on any machine.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CRED_FILES_ENV, CredentialFilesError, engineHome, parseCredentialFiles, placeCredentialFiles, takeCredentialFiles } from "../credential-files.ts";
import { signinsSettled, spawnCli } from "../session.ts";
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
  const expected = `${ACCESS.length}:${ACCESS.slice(-4)}`;
  assert.equal(reply.item.text, `codex signed in as ${expected} mode 600 env none`);
  assert.equal(r.text.includes(ACCESS), false, "the stand-in never prints the token");
  assert.equal(fs.existsSync(path.join(engineHome(r.dir, r.cwd), ".codex", "auth.json")), false, "removed after the turn");
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("a Grok turn reads its sign-in from its home, and the files are gone when it ends", async () => {
  const r = await run("grok", GROK_FILES, "authcheck");
  const result = JSON.parse(r.text.split("\n").find((l) => l.includes('"type":"result"'))!) as { result: string };
  const expected = `${GROK.length}:${GROK.slice(-4)}`;
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

// ---- a sign-in the CLI refreshed during its turn is read back before the files are removed

const OLD_AT = "2026-10-01T10:00:00.000Z";
const codexAt = (access: string, at: string, account = "acct-1"): string => JSON.stringify({ ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: idTok(account), access_token: access, refresh_token: `rt-${access}` }, last_refresh: at }) });
const idTok = (account: string): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_user_id: "u-1" } })).toString("base64url")}.sig`;
/** What the stand-in refreshes the access token to on "authrefresh r1": the old one with the tag after it. */
const NEW = `${ACCESS}-r1`;

/** One turn of a stand-in CLI with its sign-in files, collecting what it hands back; settles every save before it answers. */
async function turnBack(cli: "codex" | "grok", files: string, prompt: string, back?: (f: Readonly<Record<string, string | null>>) => Promise<void>): Promise<{ handed: Readonly<Record<string, string | null>>[]; text: string; code: number | null; w: ReturnType<typeof plan>; file: string }> {
  const w = plan();
  const handed: Readonly<Record<string, string | null>>[] = [];
  const proc = await spawnCli(w.plan, { argv: [cli], env: { [CRED_FILES_ENV]: files }, cwd: w.cwd, signinBack: async (f) => { handed.push(f); await back?.(f); } }, [cli], { wrapOf });
  proc.write(prompt);
  proc.endInput();
  let text = "";
  for await (const c of proc.stdout) text += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
  const exit = await proc.exited;
  await signinsSettled();
  return { handed, text, code: exit.code, w, file: path.join(engineHome(w.dir, w.cwd), cli === "codex" ? ".codex/auth.json" : ".grok/auth.json") };
}

test("a Codex turn that refreshes its token hands the refreshed file back before it is removed", async () => {
  const filled = codexAt(ACCESS, OLD_AT);
  const r = await turnBack("codex", filled, "authrefresh r1");
  assert.match(r.text, new RegExp(`codex refreshed to ${NEW.length}:${NEW.slice(-4)}`));
  assert.equal(r.handed.length, 1, "handed back once");
  const auth = JSON.parse(r.handed[0]![".codex/auth.json"]!) as { tokens: { access_token: string; refresh_token: string; id_token: string }; last_refresh: string };
  assert.equal(auth.tokens.access_token, NEW);
  assert.equal(auth.tokens.refresh_token, `rt-${NEW}`);
  assert.equal(auth.tokens.id_token, idTok("acct-1"), "the account is unchanged");
  assert.ok(Date.parse(auth.last_refresh) > Date.parse(OLD_AT));
  assert.equal(r.text.includes(NEW), false, "the token is never in the output");
  assert.equal(fs.existsSync(r.file), false, "removed after the save settled");
  fs.rmSync(r.w.dir, { recursive: true, force: true });
});

test("a Grok turn that refreshes hands its file back too", async () => {
  const r = await turnBack("grok", GROK_FILES, "authrefresh r1");
  assert.equal(r.handed.length, 1);
  assert.equal((JSON.parse(r.handed[0]![".grok/auth.json"]!) as { token: string }).token, `${GROK}-r1`);
  assert.equal(fs.existsSync(r.file), false);
  fs.rmSync(r.w.dir, { recursive: true, force: true });
});

test("a turn that leaves the files as they were hands nothing back", async () => {
  const r = await turnBack("codex", codexAt(ACCESS, OLD_AT), "authcheck");
  assert.match(r.text, /codex signed in as/);
  assert.deepEqual(r.handed, []);
  assert.equal(fs.existsSync(r.file), false);
  fs.rmSync(r.w.dir, { recursive: true, force: true });
});

test("a CLI that refreshes and then crashes mid-turn still hands its refreshed file back", async () => {
  const r = await turnBack("codex", codexAt(ACCESS, OLD_AT), "authcrash r1");
  assert.equal(r.code, 3, "the stand-in died");
  assert.equal(r.handed.length, 1);
  assert.equal((JSON.parse(r.handed[0]![".codex/auth.json"]!) as { tokens: { access_token: string } }).tokens.access_token, NEW);
  assert.equal(fs.existsSync(r.file), false);
  fs.rmSync(r.w.dir, { recursive: true, force: true });
});

test("a sign-out reads back as a file that is gone; the host decides what to do with it", async () => {
  const r = await turnBack("codex", codexAt(ACCESS, OLD_AT), "authlogout");
  assert.deepEqual(r.handed, [{ ".codex/auth.json": null }]);
  fs.rmSync(r.w.dir, { recursive: true, force: true });
});

test("the files stay in place until the save has settled, then go", async () => {
  const w = plan();
  const f = path.join(engineHome(w.dir, w.cwd), ".codex", "auth.json");
  let during = false;
  const proc = await spawnCli(w.plan, { argv: ["codex"], env: { [CRED_FILES_ENV]: codexAt(ACCESS, OLD_AT) }, cwd: w.cwd, signinBack: async () => { await new Promise((ok) => setTimeout(ok, 30)); during = fs.existsSync(f); } }, ["codex"], { wrapOf });
  proc.write("authrefresh r1");
  proc.endInput();
  for await (const _ of proc.stdout) { /* drain */ }
  await proc.exited;
  await signinsSettled();
  assert.equal(during, true, "still there while the save ran");
  assert.equal(fs.existsSync(f), false, "gone once it settled");
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test("two turns of one account at once: the second keeps the newer file the first refreshed, and the file stays until the last one ends", () => {
  const w = plan();
  const filled = codexAt(ACCESS, OLD_AT);
  const a = placeCredentialFiles(w.dir, w.cwd, filled);
  const f = path.join(a.home, ".codex", "auth.json");
  // the first turn's CLI refreshes (the Vault still holds the old sign-in)
  const refreshed = JSON.parse(codexAt(NEW, "2026-10-01T11:00:00.000Z"))[".codex/auth.json"] as string;
  fs.writeFileSync(f, refreshed);
  const b = placeCredentialFiles(w.dir, w.cwd, filled);
  assert.equal(fs.readFileSync(f, "utf8"), refreshed, "the second turn did not overwrite the newer sign-in with the Vault's older one");
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), "600");
  assert.deepEqual(a.changed(), { ".codex/auth.json": refreshed });
  a.release();
  assert.equal(fs.readFileSync(f, "utf8"), refreshed, "the first to end leaves the file the second still runs on");
  assert.deepEqual(b.changed(), { ".codex/auth.json": refreshed }, "the second hands back the newer file too, though it did not write it");
  b.release();
  assert.equal(fs.existsSync(f), false, "removed when the last one ends");
  // an older file, or another account's, is overwritten with what the Vault holds
  for (const disk of [codexAt(NEW, "2026-09-01T00:00:00.000Z"), codexAt(NEW, "2026-10-02T00:00:00.000Z", "acct-other")]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.parse(disk)[".codex/auth.json"] as string);
    const c = placeCredentialFiles(w.dir, w.cwd, filled);
    assert.equal(fs.readFileSync(f, "utf8"), JSON.parse(filled)[".codex/auth.json"]);
    assert.equal(c.changed(), null);
    c.release();
  }
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test("a newer sign-in a daemon left behind when it died mid-turn is kept and handed back at the end of the next turn", () => {
  const w = plan();
  const home = engineHome(w.dir, w.cwd);
  const f = path.join(home, ".codex", "auth.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const left = JSON.parse(codexAt(NEW, "2026-10-01T11:00:00.000Z"))[".codex/auth.json"] as string;
  fs.writeFileSync(f, left, { mode: 0o644 });
  const p = placeCredentialFiles(w.dir, w.cwd, codexAt(ACCESS, OLD_AT));
  assert.equal(fs.readFileSync(f, "utf8"), left);
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), "600");
  assert.deepEqual(p.changed(), { ".codex/auth.json": left });
  p.release();
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test("a link left where a sign-in file was is removed, never followed: the file it points at is neither read back nor wiped", () => {
  const w = plan();
  const target = path.join(w.dir, "daemon-file.db");
  fs.writeFileSync(target, "precious");
  const p = placeCredentialFiles(w.dir, w.cwd, codexAt(ACCESS, OLD_AT));
  const f = path.join(p.home, ".codex", "auth.json");
  fs.unlinkSync(f);
  fs.symlinkSync(target, f);
  assert.deepEqual(p.changed(), { ".codex/auth.json": null }, "a link reads as no file");
  p.release();
  assert.equal(fs.readFileSync(target, "utf8"), "precious", "the target is untouched");
  assert.throws(() => fs.lstatSync(f), "the link is gone");
  fs.rmSync(w.dir, { recursive: true, force: true });
});
