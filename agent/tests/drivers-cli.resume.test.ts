// @nocache  (these tests start real processes and read fixture files that are not imports, so a pass is never reused from the cache)
// Resume and compact of a CLI engine session (lane l-sessions): the engine's own session id is handed to the host each time it changes and passed back as --resume / exec resume when the chat's next
// session opens; a session the CLI says is gone starts a new one from the chat's summary and recent messages and says so in one line; Claude Code compacts its own session with /compact and what to keep,
// and the engines without a headless compact say so. Real processes (agent/fixtures/golden-streams/fake-cli.mjs), no mocks of the driver.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver, createClaudeDecoder } from "../src/drivers/cli/index.ts";
import type { CliDriverDeps } from "../src/drivers/cli/index.ts";
import { sessionGone } from "../src/drivers/cli/errors.ts";
import { goneLine } from "../src/drivers/cli/session.ts";
import type { DriverEvent, SessionSpec } from "../src/turn-engine/types.ts";
import { collect, driverDeps, kinds, message, newSpy, specOf, turnOf } from "../fixtures/golden-streams/rig.ts";

type Saved = Array<string | null>;
const open = (id: "claude_code" | "codex" | "grok", resume: string | null, saved: Saved, spy = newSpy(), over: Partial<CliDriverDeps> = {}) =>
  createCliDriver(CLI_ADAPTERS[id], driverDeps(spy, { resume: () => resume, checkpoint: (_s: SessionSpec, sid: string | null) => { saved.push(sid); }, ...over })).open(specOf());
const argOf = (argv: readonly string[] | undefined, flag: string): string | undefined => { const a = argv ?? []; const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
const notes = (events: readonly DriverEvent[]): string[] => events.flatMap((e) => (e.type === "block" && e.kind === "turn_status" ? [String((e.payload as { text?: unknown }).text)] : []));

test("the CLI's own words for a session that is not there are told apart from every other failure", () => {
  for (const said of ["No conversation found with session ID: 7c1e", "Error: No saved session found with ID 019a-77", "Error: Session does not exist", "No session found with id abc."]) assert.equal(sessionGone(said), true, said);
  for (const said of ["Invalid API key. Please run /login", "rate limit reached", "boom: the engine crashed", ""]) assert.equal(sessionGone(said), false, said);
});

test("Claude Code's compact_boundary is read as a compaction with the tokens before and after; Claude Code's compact command carries what to keep on one line", () => {
  const d = createClaudeDecoder();
  assert.deepEqual(d.push(JSON.stringify({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 81_000, post_tokens: 4_200 } })), [{ type: "compacted", before: 81_000, after: 4_200 }]);
  assert.deepEqual(d.push(JSON.stringify({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 150_000 } })), [{ type: "compacted", before: 150_000 }], "post_tokens is optional in the CLI's schema");
  assert.equal(CLI_ADAPTERS.claude_code.compactCommand?.("the lease\n  and the dates "), "/compact the lease and the dates");
  assert.equal(CLI_ADAPTERS.claude_code.compactCommand?.(""), "/compact");
  assert.equal(CLI_ADAPTERS.codex.compactCommand, undefined, "codex exec has no compact");
  assert.equal(CLI_ADAPTERS.grok.compactCommand, undefined, "Grok's /compact takes no instructions and is not proven headless");
});

test("a new engine session's id goes to the host once; a session opened with a kept id resumes it and does not write it again", async () => {
  const saved: Saved = [];
  const s = await open("claude_code", null, saved);
  try {
    await collect(s.send(turnOf("text")));
    await collect(s.send(turnOf("text")));
    const id = (await s.checkpoint()).sessionId;
    assert.ok(id !== null && id.startsWith("fake-"));
    assert.deepEqual(saved, [id], "kept once, when the engine named it");
  } finally { await s.close(); }

  const spy = newSpy();
  const again: Saved = [];
  const r = await open("claude_code", "kept-123", again, spy);
  try {
    const events = await collect(r.send(turnOf("text")));
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(argOf(spy.launches[0], "--resume"), "kept-123", "the kept id is passed when the session opens");
    assert.deepEqual(again, [], "the same id is not written again");
    assert.deepEqual(notes(events), [], "a resume that worked says nothing");
  } finally { await r.close(); }
});

test("Codex and Grok resume the kept id on every turn's process", async () => {
  for (const id of ["codex", "grok"] as const) {
    const spy = newSpy();
    const saved: Saved = [];
    const s = await open(id, "kept-9", saved, spy);
    try {
      assert.equal((await collect(s.send(turnOf("text")))).at(-1)?.type, "done", id);
      const argv = spy.launches[0] ?? [];
      if (id === "codex") assert.equal(argv[argv.indexOf("resume") + 1], "kept-9");
      else assert.equal(argOf(argv, "--resume"), "kept-9");
      assert.deepEqual(saved, [], `${id}: the session kept its id`);
    } finally { await s.close(); }
  }
});

for (const id of ["claude_code", "codex", "grok"] as const) {
  test(`${id}: a kept session the CLI no longer has starts a new one from the chat's summary and recent messages, says so in one line, and the new id is kept`, async () => {
    const spy = newSpy();
    const saved: Saved = [];
    const s = await open(id, "gone-1", saved, spy);
    try {
      const history = [message("the lease starts in May", "m0", { threadSeq: 1 }), message("text", "m1", { threadSeq: 2 })];
      const events = await collect(s.send(turnOf("text", { history, trigger: history[1]! })));
      assert.equal(events.at(-1)?.type, "done", JSON.stringify(events));
      assert.equal(events.filter((e) => e.type === "error").length, 0, "the gone session is not an error");
      assert.deepEqual(notes(events), [goneLine(id)], "said once");
      assert.equal(kinds(events)[0], "block:turn_status", "the line comes before the answer");
      const last = spy.launches.at(-1) ?? [];
      assert.ok(!last.includes("--resume") && !last.includes("resume"), "the new process resumes nothing");
      assert.equal(saved[0], null, "the gone id is forgotten");
      const fresh = (await s.checkpoint()).sessionId;
      assert.ok(fresh !== null && !fresh.startsWith("gone-"));
      assert.deepEqual(saved, [null, fresh], "and the new one kept");
      const prompt = spy.writes.at(-1) ?? "";
      assert.match(prompt, /Earlier in this thread/, "the new session is given the recent messages, as any fresh start is");
      assert.match(prompt, /the lease starts in May/);
    } finally { await s.close(); }
  });
}

test("Claude Code compacts its own session: /compact with what to keep goes to the session it holds, and the tokens before and after come back", async () => {
  const spy = newSpy();
  const saved: Saved = [];
  const s = await open("claude_code", "kept-7", saved, spy);
  try {
    const events = await collect(s.send({ ...turnOf("x"), trigger: null, compact: { keep: "the open questions\nabout the lease" } }));
    assert.deepEqual(events.filter((e) => e.type === "block"), [{ type: "block", kind: "compacted", payload: { before: 50_000, after: 3_000 } }]);
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(JSON.parse(spy.writes.at(-1) ?? "{}").message.content[0].text, "/compact the open questions about the lease", "what to keep travels as the command's instructions, with no turn context in front");
    assert.equal(argOf(spy.launches[0], "--resume"), "kept-7");
    assert.equal((await s.checkpoint()).sessionId, "kept-7", "the engine goes on in the same session");
    // the turn after it is sent the whole turn context again: the engine's context is now its own summary
    await collect(s.send({ ...turnOf("text"), context: { names: {}, sections: [{ id: "identity", stable: true, text: "You are Intake." }] } }));
    assert.match(JSON.parse(spy.writes.at(-1) ?? "{}").message.content[0].text, /You are Intake\./);
  } finally { await s.close(); }
});

test("a compact with nothing to compact, on an engine with no headless compact, or on a session the CLI no longer has, says which, so the caller compacts for it", async () => {
  const none = await open("claude_code", null, []);
  try {
    const e = await collect(none.send({ ...turnOf("x"), trigger: null, compact: { keep: "" } }));
    assert.deepEqual(e.map((x) => (x.type === "error" ? x.code : x.type)), ["engine.nothing_to_compact"]);
  } finally { await none.close(); }

  const codex = await open("codex", "kept-1", []);
  try {
    const e = await collect(codex.send({ ...turnOf("x"), trigger: null, compact: { keep: "dates" } }));
    assert.deepEqual(e.map((x) => (x.type === "error" ? x.code : x.type)), ["engine.compact_unsupported"]);
  } finally { await codex.close(); }

  const saved: Saved = [];
  const gone = await open("claude_code", "gone-2", saved);
  try {
    const e = await collect(gone.send({ ...turnOf("x"), trigger: null, compact: { keep: "dates" } }));
    assert.deepEqual(e.map((x) => (x.type === "error" ? x.code : x.type)), ["engine.session_gone"]);
    assert.deepEqual(saved, [null], "the gone id is forgotten");
    assert.equal((await gone.checkpoint()).sessionId, null);
  } finally { await gone.close(); }
});
