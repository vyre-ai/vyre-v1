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
