// An agent folder is never empty: AGENT.md and agent.toml in an agent's folder cannot be deleted, moved or renamed through files.*, and the refusal says why (P-L5_30).
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

function world() {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(readFileSync(join(dir, f), "utf8"));
  configureFilesHost({ resources: { ensure: async () => {} } });
  let clock = 1_790_000_000_000;
  const ctx = {
    space: "spc_t", principal: { kind: "person", id: "usr_a" }, trace: { traceId: "t".repeat(32), spanId: "s".repeat(16) }, origin: "api", depth: 0, now: () => (clock += 1000),
    db: { all: (q: string, ...a: unknown[]) => sql.prepare(q).all(...(a as never[])) as unknown[], run: (q: string, ...a: unknown[]) => ({ changes: Number(sql.prepare(q).run(...(a as never[])).changes) }) },
    emit: ((_n: string, _s: string, p: unknown) => ({ payload: p })) as never, call: (async () => ({ rows: [], total: 0 })) as never,
    log: { debug() {}, info() {}, warn() {}, error() {} }, authorize: (() => ({ effect: "allow", reason: "", decisionId: "d" })) as never,
  } as unknown as Ctx;
  return { ctx, sql };
}

async function agentFolder(ctx: Ctx, name = "Scout") {
  const tree = (await run["files.tree"]!(ctx, {})) as { roots: { key: string; folderId?: string }[] };
  const agentsId = tree.roots.find((r) => r.key === "agents")!.folderId!;
  const home = (await run["files.folder.create"]!(ctx, { parentId: agentsId, name, idempotencyKey: `f-${name}` })).folder.folderId as string;
  const memory = (await run["files.folder.create"]!(ctx, { parentId: home, name: "memory", idempotencyKey: `m-${name}` })).folder.folderId as string;
  const make = async (folderId: string, fname: string): Promise<string> => (await run["files.create"]!(ctx, { folderId, name: fname, content: { text: `# ${fname}\n` }, idempotencyKey: `c-${folderId}-${fname}` })).file.fileId as string;
  return { agentsId, home, memory, make };
}

const refusal = async (p: Promise<unknown>): Promise<{ code: string; message: string; details?: Record<string, unknown> }> => {
  try { await p; } catch (e) { return (e as { error: { code: string; message: string; details?: Record<string, unknown> } }).error; }
  assert.fail("the call was accepted");
};

test("AGENT.md and agent.toml in an agent's folder cannot be deleted, moved or renamed, and the refusal says why", async () => {
  const w = world();
  const a = await agentFolder(w.ctx);
  const md = await a.make(a.home, "AGENT.md");
  const toml = await a.make(a.home, "agent.toml");
  for (const [id, name] of [[md, "AGENT.md"], [toml, "agent.toml"]] as const) {
    const del = await refusal(run["files.delete"]!(w.ctx, { fileId: id }));
    assert.equal(del.code, "validation.precondition_failed");
    assert.match(del.message, new RegExp(`${name.replace(".", "\\.")} is part of the agent, so it cannot be deleted\\. Edit it, or delete the agent`));
    assert.equal(del.details?.["reason"], "agent_file");
    assert.match((await refusal(run["files.rename"]!(w.ctx, { fileId: id, name: "other.txt" }))).message, /cannot be renamed/);
    assert.match((await refusal(run["files.move"]!(w.ctx, { fileId: id, toFolderId: a.memory }))).message, /cannot be moved/);
    assert.match((await refusal(run["files.move"]!(w.ctx, { fileId: id, toFolderId: a.home, name: "x.md" }))).message, /cannot be moved/, "a move that renames is a rename");
    const still = (await run["files.get"]!(w.ctx, { fileId: id })).file;
    assert.deepEqual([still.name, still.folderId, still.deletedAt], [name, a.home, undefined], "nothing changed");
  }
});

test("editing them stays open, and so does everything else: the same names deeper in the tree, other files, other folders, and the agent's own deletion", async () => {
  const w = world();
  const a = await agentFolder(w.ctx);
  const md = await a.make(a.home, "AGENT.md");
  const deeper = await a.make(a.memory, "AGENT.md");
  const notes = await a.make(a.home, "notes.md");
  const personal = await a.make((await agentFolder(w.ctx, "Other")).memory, "agent.toml");
  const written = await run["files.write"]!(w.ctx, { fileId: md, content: { text: "# Scout\nmore\n" } });
  assert.equal(written.file.name, "AGENT.md", "a person edits AGENT.md");
  assert.equal((await run["files.rename"]!(w.ctx, { fileId: notes, name: "notes-2.md" })).file.name, "notes-2.md");
  assert.equal((await run["files.delete"]!(w.ctx, { fileId: deeper })).deleted, true, "AGENT.md in a subfolder is only a file");
  assert.equal((await run["files.delete"]!(w.ctx, { fileId: personal })).deleted, true, "agent.toml outside an agent's own folder is only a file");
  assert.equal((await run["files.folder.delete"]!(w.ctx, { folderId: a.home })).deleted, true, "deleting the agent takes its folder, files and all");
});
