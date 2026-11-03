// agent.toml is an agent's settings. Before Files writes a new version of a file named agent.toml (files.write, files.save through it, files.restore_version) it asks the agents module, as the writer,
// whether that writer may change the agent's settings (agents.config.may_save). A no refuses the write before anything is written: no version, no event, the text as it was.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /modules/files/migrations/0005_files_entities.sql
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureFilesHost, handlers } from "../impl.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
type H = Record<string, (ctx: Ctx, input: unknown) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const run = handlers as unknown as H;
type Answer = { agentId: string | null; allowed: boolean; reason?: string; message?: string } | Error;

const TOML = 'name = "Scout"\nmodel = "claude-sonnet-5-5"\naccount_policy = "asker"\n';
const WIDER = 'name = "Scout"\nmodel = "claude-opus-5-5"\naccount_policy = "asker"\n\n[vault]\nkeys = ["#Olivia_Key"]\n';

function world() {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(readFileSync(join(dir, f), "utf8"));
  configureFilesHost({ resources: { ensure: async () => {}, setLabel: async () => {} } });
  let clock = 1_790_000_000_000;
  const asked: string[] = [];
  const events: Array<{ name: string; payload: unknown }> = [];
  let answer: Answer = { agentId: null, allowed: true };
  const ctx = {
    space: "spc_t", principal: { kind: "person", id: "usr_a" }, trace: { traceId: "t".repeat(32), spanId: "s".repeat(16) }, origin: "api", depth: 0, now: () => (clock += 1000),
    db: { all: (q: string, ...a: unknown[]) => sql.prepare(q).all(...(a as never[])) as unknown[], run: (q: string, ...a: unknown[]) => ({ changes: Number(sql.prepare(q).run(...(a as never[])).changes) }) },
    emit: ((name: string, _s: string, payload: unknown) => { events.push({ name, payload }); return { payload }; }) as never,
    call: (async (cap: string, input: { fileId?: string }) => {
      if (cap === "agents.config.may_save") { asked.push(String(input.fileId)); if (answer instanceof Error) throw answer; return answer; }
      if (cap === "files.lint") return run["files.lint"]!(ctx, input);
      return { rows: [], total: 0 };
    }) as never,
    seal: { seal(bytes: Uint8Array) { return { keyId: "test", nonce: "test", bytes: Buffer.from(bytes).toString("base64") }; }, unseal(value: { bytes: string }) { return Uint8Array.from(Buffer.from(value.bytes, "base64")); } },
    log: { debug() {}, info() {}, warn() {}, error() {} }, authorize: (() => ({ effect: "allow", reason: "", decisionId: "d" })) as never,
  } as unknown as Ctx;
  return { ctx, asked, events, answer: (a: Answer) => { answer = a; } };
}

async function agentToml(ctx: Ctx) {
  const tree = (await run["files.tree"]!(ctx, {})) as { roots: { key: string; folderId?: string }[] };
  const agentsId = tree.roots.find((r) => r.key === "agents")!.folderId!;
  const home = (await run["files.folder.create"]!(ctx, { parentId: agentsId, name: "Scout", subject: { kind: "agent", id: "agt_scout1" }, idempotencyKey: "f-scout" })).folder.folderId as string;
  const toml = (await run["files.create"]!(ctx, { folderId: home, name: "agent.toml", content: { text: TOML }, idempotencyKey: "c-toml" })).file.fileId as string;
  const notes = (await run["files.create"]!(ctx, { folderId: home, name: "notes.md", content: { text: "# notes\n" }, idempotencyKey: "c-notes" })).file.fileId as string;
  return { home, toml, notes };
}

const refusal = async (p: Promise<unknown>): Promise<{ code: string; message: string; details?: Record<string, unknown> }> => {
  try { await p; } catch (e) { return (e as { error: { code: string; message: string; details?: Record<string, unknown> } }).error; }
  assert.fail("the write was accepted");
};
const textOf = async (ctx: Ctx, fileId: string): Promise<string> => String((await run["files.read"]!(ctx, { fileId, as: "text" })).text);

test("a writer who may not change the agent's settings is refused on every way to write agent.toml, before anything is written", async () => {
  const w = world();
  const a = await agentToml(w.ctx);
  // a first good version by the owner, so there is an older one to restore
  await run["files.write"]!(w.ctx, { fileId: a.toml, content: { text: `${TOML}handoffs = []\n` } });
  const versions = (await run["files.versions"]!(w.ctx, { fileId: a.toml })).versions as Array<{ versionId: string; n: number }>;
  const before = { text: await textOf(w.ctx, a.toml), versions: versions.length, version: (await run["files.get"]!(w.ctx, { fileId: a.toml })).file.version };
  w.events.length = 0;
  const said = "agent.toml is this agent's settings, and only a person can change an agent's settings. Ask the person you act for, or suggest the change with agents.suggestion.propose.";
  w.answer({ agentId: "agt_scout1", allowed: false, reason: "person_only", message: said });
  const tries: Array<[string, Record<string, unknown>]> = [
    ["files.write", { fileId: a.toml, content: { text: WIDER } }],
    ["files.save", { fileId: a.toml, text: WIDER, acceptWarnings: true }],
    ["files.restore_version", { fileId: a.toml, versionId: versions.find((v) => v.n === 1)!.versionId }],
  ];
  for (const [cap, input] of tries) {
    const r = await refusal(run[cap]!(w.ctx, input));
    assert.equal(r.code, "permission.no_grant", cap);
    assert.equal(r.message, said, `${cap}: the words come from the agents module`);
    assert.deepEqual([r.details?.["reason"], r.details?.["why"], r.details?.["agentId"]], ["agent_settings", "person_only", "agt_scout1"], cap);
  }
  assert.equal(await textOf(w.ctx, a.toml), before.text, "the text is as it was");
  assert.equal((await run["files.versions"]!(w.ctx, { fileId: a.toml })).versions.length, before.versions, "no version was added");
  assert.equal((await run["files.get"]!(w.ctx, { fileId: a.toml })).file.version, before.version);
  assert.deepEqual(w.events.map((e) => e.name), [], "no event, so nothing downstream reads it as settings");
  assert.ok(w.asked.every((id) => id === a.toml), "it asked about agent.toml only");
});

test("a writer who may is written as before; other files never ask", async () => {
  const w = world();
  const a = await agentToml(w.ctx);
  w.answer({ agentId: "agt_scout1", allowed: true });
  const out = await run["files.save"]!(w.ctx, { fileId: a.toml, text: WIDER, acceptWarnings: true });
  assert.ok(out.versionId, "saved");
  assert.equal(await textOf(w.ctx, a.toml), WIDER);
  assert.ok(w.events.some((e) => e.name === "file.version_added"));
  w.asked.length = 0;
  w.answer({ agentId: null, allowed: false, message: "never asked" });
  await run["files.write"]!(w.ctx, { fileId: a.notes, content: { text: "# notes\nmore\n" } });
  assert.deepEqual(w.asked, [], "notes.md is not settings");
});

test("when the agents module is not there nothing reads agent.toml as settings, so the write goes on; any other failure to ask refuses it", async () => {
  const w = world();
  const a = await agentToml(w.ctx);
  w.answer(Object.assign(new Error("not built"), { error: { code: "internal.not_implemented", message: "This feature is not built yet." } }));
  await run["files.write"]!(w.ctx, { fileId: a.toml, content: { text: WIDER } });
  assert.equal(await textOf(w.ctx, a.toml), WIDER);
  w.answer(Object.assign(new Error("down"), { error: { code: "internal.unavailable", message: "down" } }));
  const r = await refusal(run["files.write"]!(w.ctx, { fileId: a.toml, content: { text: TOML } }));
  assert.equal(r.code, "permission.no_grant");
  assert.equal(r.details?.["reason"], "agent_settings");
  assert.match(r.message, /could not check that you may change them\. Nothing was saved/);
  assert.equal(await textOf(w.ctx, a.toml), WIDER, "nothing was written");
});
