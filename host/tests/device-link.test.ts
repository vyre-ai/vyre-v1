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
