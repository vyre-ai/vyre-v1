// A person's computer runs only that person's turns (lane l-runson): the second lock, on the computer itself, whatever the Space sends.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliRelay } from "../src/compute/node.ts";

test("a computer refuses a turn for anyone but its own person, and one before it knows whose it is", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-devlock-"));
  let person: string | null = null;
  let started = 0;
  const relay = cliRelay({ launcher: { spawn: async () => { started++; throw new Error("not in this test"); } }, dataDir: dir, server: "https://space.example", log: () => undefined, person: () => person });
  const said: Array<Record<string, unknown>> = [];
  const spawn = (who: string | undefined, proc: string) => relay.frame({ t: "cli_spawn", proc, argv: ["claude"], env: {}, ...(who ? { person: who } : {}) }, (m) => said.push(m));
  spawn("usr_olivia", "prc_" + "a".repeat(24));
  person = "usr_olivia";
  spawn("usr_noah", "prc_" + "b".repeat(24));
  spawn(undefined, "prc_" + "c".repeat(24));
  assert.deepEqual(said.map((m) => [m["t"], m["code"]]), [["cli_failed", "permission.no_grant"], ["cli_failed", "permission.no_grant"], ["cli_failed", "permission.no_grant"]]);
  assert.equal(started, 0, "no engine started");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the turn's network rule always reaches the Space at the address this computer joined by, and the engine works in a folder the sandbox accepts", async () => {
  const { withSpace, RULE_ENV } = await import("../src/compute/node.ts");
  assert.equal(withSpace(undefined, "https://mla.vyre.run"), JSON.stringify({ egress: "public", space: "mla.vyre.run:443" }));
  assert.equal(withSpace(JSON.stringify({ egress: "list", allow: ["api.anthropic.com"] }), "http://192.168.1.20:8420"), JSON.stringify({ egress: "list", allow: ["api.anthropic.com"], space: "192.168.1.20:8420" }));
  assert.equal(withSpace("not json", "https://x.example"), "not json", "a rule Vyre did not write is left for the sandbox to refuse");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-devwork-"));
  const seen: Array<{ cwd?: string; env: Record<string, string> }> = [];
  const relay = cliRelay({ launcher: { spawn: async (spec) => { seen.push({ ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}), env: { ...spec.env } }); throw new Error("stop here"); } }, dataDir: dir, server: "https://mla.vyre.run", log: () => undefined, person: () => "usr_olivia" });
  const said: Array<Record<string, unknown>> = [];
  relay.frame({ t: "cli_spawn", proc: "prc_" + "d".repeat(24), argv: ["claude"], env: { MCP: "http://127.0.0.1:41800/mcp" }, person: "usr_olivia" }, (m) => said.push(m));
  for (let i = 0; i < 50 && said.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(seen[0]?.cwd, path.join(dir, "work", "usr_olivia", "prc_" + "d".repeat(24)), "<data dir>/work/<person>/<process>, as modules/engine/sandbox.ts requires");
  assert.equal(seen[0]?.env["MCP"], "https://mla.vyre.run/mcp", "Vyre's tools at the Space's own address");
  assert.equal(seen[0]?.env[RULE_ENV], JSON.stringify({ egress: "public", space: "mla.vyre.run:443" }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("her own sign-in on this computer: Codex's CODEX_HOME with auth.json, Claude Code's sign-in file; the Space's account is taken out only then", async () => {
  const { ownSignin } = await import("../src/compute/device-link.ts");
  const have = (files: string[]) => (p: string) => files.includes(p);
  const env = { CODEX_API_KEY: "sk-space", VYRE_CRED_FILES: "{}", OTHER: "x" };
  const codex = ownSignin(["codex", "exec"], env, { home: "/Users/dana", env: { CODEX_HOME: "/Users/dana/.codex-work" }, platform: "darwin", exists: have(["/Users/dana/.codex-work/auth.json"]) });
  assert.deepEqual([codex["CODEX_HOME"], codex["CODEX_API_KEY"], codex["VYRE_CRED_FILES"], codex["OTHER"]], ["/Users/dana/.codex-work", undefined, undefined, "x"]);
  assert.deepEqual(JSON.parse(codex["VYRE_ENGINE_ACCESS"]!), { where: "own", folders: ["/Users/dana/.codex-work"] });
  assert.deepEqual(ownSignin(["codex"], env, { home: "/Users/dana", env: {}, platform: "darwin", exists: have([]) }), env, "not signed in here: as the Space sent it");
  const claude = ownSignin(["claude", "-p"], { CLAUDE_CODE_OAUTH_TOKEN: "t", VYRE_ENGINE_ACCESS: JSON.stringify({ where: "own", folders: ["/Users/dana/site"] }) }, { home: "/Users/dana", env: {}, platform: "linux", exists: have(["/Users/dana/.claude/.credentials.json"]) });
  assert.equal(claude["CLAUDE_CONFIG_DIR"], "/Users/dana/.claude");
  assert.equal(claude["CLAUDE_CODE_OAUTH_TOKEN"], undefined);
  assert.deepEqual(JSON.parse(claude["VYRE_ENGINE_ACCESS"]!).folders, ["/Users/dana/site", "/Users/dana/.claude"], "her added folders stay, and the engine's home joins them");
  const keychainOnly = ownSignin(["claude"], { CLAUDE_CODE_OAUTH_TOKEN: "t" }, { home: "/Users/dana", env: {}, platform: "darwin", exists: have(["/Users/dana/.claude.json"]) });
  assert.deepEqual(keychainOnly, { CLAUDE_CODE_OAUTH_TOKEN: "t" }, "a Mac whose sign-in is in the Keychain is handed over by macClaude, not by pointing the sandboxed engine at the Keychain");
  assert.deepEqual(ownSignin(["grok"], { XAI_API_KEY: "k" }, { home: "/h", env: {}, platform: "linux", exists: () => true }), { XAI_API_KEY: "k" }, "an engine with no home of its own here is left as it was");
});

test("Claude Code on a Mac: the Keychain sign-in is handed over as a file in a private folder, the Space's account is taken out, and a refresh goes back to the Keychain", async () => {
  const { macClaude, CLAUDE_KEYCHAIN } = await import("../src/compute/device-link.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-macclaude-"));
  const later = Date.now() + 3_600_000;
  const cred = (t: string, expiresAt = later) => JSON.stringify({ claudeAiOauth: { accessToken: t, refreshToken: "r", expiresAt } });
  const kc = new Map<string, string>([[CLAUDE_KEYCHAIN, cred("tok-1")]]);
  const writes: string[] = [];
  const homes = { home: "/Users/dana", env: {}, platform: "darwin" as const, exists: () => false, keychain: { read: (sv: string) => kc.get(sv) ?? null, write: (sv: string, t: string) => { writes.push(t); kc.set(sv, t); } } };
  const m = macClaude({ CLAUDE_CODE_OAUTH_TOKEN: "space", OTHER: "x" }, homes, dir, "usr_dana", "prc_1", 20);
  assert.ok(m);
  const cfg = m!.env["CLAUDE_CONFIG_DIR"]!;
  assert.equal(cfg, path.join(dir, "scratch", "usr_dana", "claude-own", "prc_1"), "inside the person's scratch folder, which the sandbox opens for the turn");
  assert.equal(fs.readFileSync(path.join(cfg, ".credentials.json"), "utf8"), cred("tok-1"));
  if (process.platform !== "win32") assert.equal((fs.statSync(path.join(cfg, ".credentials.json")).mode & 0o777), 0o600);
  assert.deepEqual([m!.env["CLAUDE_CODE_OAUTH_TOKEN"], m!.env["OTHER"]], ["tok-1", "x"], "her own Mac sign-in's token in place of the Space's (Claude Code on a Mac takes it from the variable)");
  // the engine refreshes in place while it is still warm: written back without waiting for it to end
  fs.writeFileSync(path.join(cfg, ".credentials.json"), cred("tok-2"));
  for (let i = 0; i < 50 && writes.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(writes, [cred("tok-2")]);
  m!.after();
  assert.equal(writes.length, 1, "an unchanged token is not written again");
  assert.equal(fs.existsSync(cfg), false, "the file is gone when the engine ends");
  assert.equal(macClaude({}, { ...homes, platform: "linux" as const }, dir, "usr_dana", "prc_2"), null, "only on a Mac");
  assert.equal(macClaude({}, { ...homes, keychain: { read: () => null, write: () => undefined } }, dir, "usr_dana", "prc_3"), null, "no Keychain sign-in: as the Space sent it");
  assert.equal(macClaude({}, { ...homes, keychain: { read: () => cred("old", Date.now() - 1000), write: () => undefined } }, dir, "usr_dana", "prc_4"), null, "a token that has run out is not handed over: the Space's fill stands");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the Keychain write-back puts nothing of the sign-in in a process's arguments: security -i, the command and the token as hex on stdin", async () => {
  const { macKeychain, CLAUDE_KEYCHAIN } = await import("../src/compute/device-link.ts");
  const runs: Array<{ args: readonly string[]; input?: string }> = [];
  const kc = macKeychain((args, input) => { runs.push({ args, ...(input !== undefined ? { input } : {}) }); return "stored\n"; }, "dana");
  const secret = JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-REFRESHEDtoken", refreshToken: "sk-ant-ort01-R" } });   // secret-scan: fake
  kc.write(CLAUDE_KEYCHAIN, secret);
  assert.deepEqual(runs[0]!.args, ["-i"], "the arguments are only -i");
  assert.ok(!runs[0]!.args.join(" ").includes("sk-ant"), "no token in argv");
  assert.equal(runs[0]!.input, `add-generic-password -U -s "Claude Code-credentials" -a "dana" -X ${Buffer.from(secret).toString("hex")}\n`);
  assert.ok(!runs[0]!.input!.includes("sk-ant"), "even on stdin it travels as hex");
  assert.equal(kc.read(CLAUDE_KEYCHAIN), "stored");
  assert.deepEqual(runs[1]!.args, ["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
});
