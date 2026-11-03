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

test("her own sign-in on this computer: Codex's CODEX_HOME with auth.json, Claude Code's Keychain marker on a Mac; the Space's account is taken out only then", async () => {
  const { ownSignin } = await import("../src/compute/device-link.ts");
  const have = (files: string[]) => (p: string) => files.includes(p);
  const env = { CODEX_API_KEY: "sk-space", VYRE_CRED_FILES: "{}", OTHER: "x" };
  const codex = ownSignin(["codex", "exec"], env, { home: "/Users/dana", env: { CODEX_HOME: "/Users/dana/.codex-work" }, platform: "darwin", exists: have(["/Users/dana/.codex-work/auth.json"]) });
  assert.deepEqual([codex["CODEX_HOME"], codex["CODEX_API_KEY"], codex["VYRE_CRED_FILES"], codex["OTHER"]], ["/Users/dana/.codex-work", undefined, undefined, "x"]);
  assert.deepEqual(JSON.parse(codex["VYRE_ENGINE_ACCESS"]!), { where: "own", folders: ["/Users/dana/.codex-work"] });
  assert.deepEqual(ownSignin(["codex"], env, { home: "/Users/dana", env: {}, platform: "darwin", exists: have([]) }), env, "not signed in here: as the Space sent it");
  const claude = ownSignin(["claude", "-p"], { CLAUDE_CODE_OAUTH_TOKEN: "t", VYRE_ENGINE_ACCESS: JSON.stringify({ where: "own", folders: ["/Users/dana/site"] }) }, { home: "/Users/dana", env: {}, platform: "darwin", exists: have(["/Users/dana/.claude.json"]) });
  assert.equal(claude["CLAUDE_CONFIG_DIR"], "/Users/dana/.claude");
  assert.equal(claude["CLAUDE_CODE_OAUTH_TOKEN"], undefined);
  assert.deepEqual(JSON.parse(claude["VYRE_ENGINE_ACCESS"]!).folders, ["/Users/dana/site", "/Users/dana/.claude"], "her added folders stay, and the engine's home joins them");
  assert.deepEqual(ownSignin(["grok"], { XAI_API_KEY: "k" }, { home: "/h", env: {}, platform: "linux", exists: () => true }), { XAI_API_KEY: "k" }, "an engine with no home of its own here is left as it was");
});
