// Codex for real: cancel mid-turn, signed out, a model the account does not have, a session Codex does not have, and a read-only Ask first.
// Runs only when VYRE_TEST_CODEX_HOME names a signed-in Codex home; otherwise every test here is SKIPPED with that reason, never passed. See test/support/codex-real.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME, answer, collect, errors, launcher, open, opts, say, toolNames, work } from "./support/codex-real.ts";
import type { DriverEvent } from "../agent/src/turn-engine/types.ts";

test("(e) cancelling mid-turn stops the process quickly and the next turn still works", opts, async () => {
  const s = await open("");
  const it = s.send(say("Run the shell command `sleep 120` and then say done.", "m1"))[Symbol.asyncIterator]();
  const seen: DriverEvent[] = [];
  const t0 = Date.now();
  for (;;) {
    const r = await it.next();
    if (r.done) break;
    seen.push(r.value);
    if (r.value.type === "block" && r.value.kind === "tool_call") { void s.cancel(); }
  }
  assert.ok(Date.now() - t0 < 60_000, "the cancel ended the turn");
  assert.ok(toolNames(seen).length > 0, "it had started the command");
  assert.equal(seen.some((e) => e.type === "done"), false);
  const next = await collect(s.send(say("Reply with the single word pong.", "m2")));
  assert.deepEqual(errors(next), []);
  assert.match(answer(next), /pong/i);
  await s.close();
});

test("(g) signed out: a plain sign-in message with the auth code, never a crash", opts, async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-codex-empty-"));
  try {
    const s = await open("", {}, "auto", empty);
    const ev = await collect(s.send(say("hello")));
    const e = errors(ev);
    assert.equal(e.length, 1, JSON.stringify(ev));
    assert.equal(e[0]!.code, "provider.auth_failed", e[0]!.message);
    assert.doesNotMatch(e[0]!.message, /Bearer|stack|at .*\(/);
    await s.close();
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test("(i) a model the account does not have is a model_unavailable error in plain words, not the vendor's JSON", opts, async () => {
  const s = await open("gpt-0-not-a-model");
  const ev = await collect(s.send(say("hello")));
  const e = errors(ev);
  assert.equal(e.length, 1, JSON.stringify(ev));
  assert.equal(e[0]!.code, "engine.model_unavailable");
  assert.doesNotMatch(e[0]!.message, /^\s*\{/);
  await s.close();
});

test("(j) a session id Codex does not have starts a new session and says so, once", opts, async () => {
  const s = await open("", { resume: () => "01a1ae88-0000-7000-8000-000000000000" });
  const ev = await collect(s.send(say("Reply with the single word pong.")));
  assert.deepEqual(errors(ev), []);
  assert.match(answer(ev), /pong/i);
  assert.equal(ev.filter((e) => e.type === "block" && e.kind === "turn_status").length, 1);
  await s.close();
});

test("(k) in Ask first the work folder is read-only: Codex cannot write a file, and the turn still ends with an answer", opts, async () => {
  const s = await open("", {}, "ask");
  const ev = await collect(s.send(say("Create a file named forbidden.txt in the current folder containing x, then tell me whether it worked.")));
  assert.deepEqual(errors(ev), []);
  assert.equal(fs.existsSync(path.join(work, "forbidden.txt")), false, "read-only: nothing was written");
  assert.equal(ev.at(-1)?.type, "done");
  await s.close();
});
