// The CLI engines on a computer that joined the Space: the report says exactly what is missing, and the launcher refuses with that reason instead of starting anything unwrapped.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProgram, nodeCliLauncher, nodeCliReport } from "../node-cli.ts";

function bin(names: string[]): { dir: string; env: { PATH: string } } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cli-bin-"));
  for (const n of names) fs.writeFileSync(path.join(dir, n), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { dir, env: { PATH: dir } };
}
const bwrap = (dir: string): string => { const f = path.join(dir, "bwrap"); fs.writeFileSync(f, "#!/bin/sh\n", { mode: 0o755 }); return f; };

test("the report finds Claude Code and Codex on the PATH and bubblewrap for the sandbox: nothing is missing", () => {
  const { dir, env } = bin(["claude", "codex"]);
  const r = nodeCliReport({ platform: "linux", env, bwrapPaths: [bwrap(dir)] });
  assert.deepEqual([r.programs.claude, r.programs.codex], [path.join(dir, "claude"), path.join(dir, "codex")]);
  assert.deepEqual([r.sandbox.ok, r.sandbox.kind, r.missing], [true, "bwrap", []]);
  assert.equal(findProgram("claude", { env }), path.join(dir, "claude"));
});

test("the report says exactly what is missing, one sentence each", () => {
  const { env } = bin(["claude"]);
  const r = nodeCliReport({ platform: "linux", env, bwrapPaths: ["/nonexistent/bwrap"] });
  assert.equal(r.programs.codex, null);
  assert.deepEqual(r.missing, ["codex is not installed on this server", "bubblewrap (bwrap) is not installed on this server"]);
  assert.deepEqual(nodeCliReport({ platform: "darwin", env: bin(["claude", "codex"]).env }).missing, [], "a Mac sandboxes with Seatbelt");
  assert.deepEqual(nodeCliReport({ platform: "win32", env: bin(["claude", "codex"]).env }).missing, ["engines cannot be sandboxed on win32"]);
});

test("the launcher refuses a missing engine or sandbox with the reason, and starts a found engine only inside the sandbox", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cli-data-"));
  const started: string[] = [];
  const spawn = async (spec: { argv: readonly string[] }): Promise<never> => { started.push(spec.argv.join(" ")); return {} as never; };
  const none = bin([]);
  const missingProgram = nodeCliLauncher(dataDir, { probe: { platform: "linux", env: none.env, bwrapPaths: [bwrap(none.dir)] }, spawn });
  await assert.rejects(() => missingProgram.spawn({ argv: ["claude", "-p"], env: {} }), (e) => (e as { code?: string }).code === "engine.cli_missing" && /claude is not installed on this server/.test((e as Error).message));
  const noBwrap = bin(["claude"]);
  const missingSandbox = nodeCliLauncher(dataDir, { probe: { platform: "linux", env: noBwrap.env, bwrapPaths: ["/nonexistent/bwrap"] }, spawn });
  await assert.rejects(() => missingSandbox.spawn({ argv: ["claude", "-p"], env: {} }), (e) => (e as { code?: string }).code === "sandbox.unavailable" && /bubblewrap/.test((e as Error).message));
  assert.deepEqual(started, [], "nothing started");
  const ok = bin(["claude"]);
  await nodeCliLauncher(dataDir, { probe: { platform: "linux", env: ok.env, bwrapPaths: [bwrap(ok.dir)] }, spawn }).spawn({ argv: ["claude", "-p"], env: {} });
  assert.deepEqual(started, ["claude -p"]);
});
