// Shared pieces of the real-Codex live tests (test/codex.real.*.live.test.ts, lane l-codex): the CLI driver around the real `codex` program, signed in with a ChatGPT subscription.
// Runs only when VYRE_TEST_CODEX_HOME names a signed-in Codex home (the folder that holds auth.json); otherwise every test here is SKIPPED with that reason, never passed.
// The home is read in place: nothing of it is copied, logged or printed. A signed-out run uses an empty home the test makes itself.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CLI_ADAPTERS, createCliDriver, createLocalLauncher } from "../../agent/src/drivers/cli/index.ts";
import type { CliDriverDeps } from "../../agent/src/drivers/cli/index.ts";
export { collect, driverCaller, startMcp } from "../../agent/fixtures/golden-streams/rig.ts";
import { collect, message, specOf, texts, turnOf } from "../../agent/fixtures/golden-streams/rig.ts";
import type { DriverEvent } from "../../agent/src/turn-engine/types.ts";

export const HOME = process.env["VYRE_TEST_CODEX_HOME"] ?? "";
const bin = spawnSync("codex", ["--version"], { encoding: "utf8" });
const why = HOME === "" ? "VYRE_TEST_CODEX_HOME is not set: no signed-in Codex home to run against" : !fs.existsSync(path.join(HOME, "auth.json")) ? "VYRE_TEST_CODEX_HOME has no auth.json" : bin.status !== 0 ? "the codex program is not installed here" : false;
export const opts = { skip: why, timeout: 240_000 } as const;

export const work = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-codex-real-"));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

export const launcher = (codexHome: string) => createLocalLauncher({ baseEnv: { PATH: process.env["PATH"] ?? "", HOME: os.homedir(), CODEX_HOME: codexHome, LANG: "C.UTF-8" } });
export const deps = (codexHome: string, over: Partial<CliDriverDeps> = {}): CliDriverDeps => ({
  launcher: launcher(codexHome), mcp: async () => ({ url: "http://127.0.0.1:9/mcp", token: "tok-real-0123456789abcdef" }), graceMs: 1_500, workFolder: () => work, ...over,
});
export const open = (model: string, over: Partial<CliDriverDeps> = {}, mode: "auto" | "ask" | "plan" = "auto", codexHome = HOME) =>
  createCliDriver(CLI_ADAPTERS.codex, deps(codexHome, over)).open({ ...specOf({ model }), mode });
export const say = (s: string, id = "m1") => turnOf(s, { trigger: message(s, id) });
export const answer = (events: DriverEvent[]): string => texts(events).join("\n");
export const errors = (events: DriverEvent[]) => events.flatMap((e) => (e.type === "error" ? [e] : []));
export const toolNames = (events: DriverEvent[]) => events.flatMap((e) => (e.type === "block" && e.kind === "tool_call" ? [String((e.payload as { name?: string }).name)] : []));

