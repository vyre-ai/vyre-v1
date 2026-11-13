// What an agent makes while acting for a person belongs to that person: their saved blocks, snippets and designs, read and changed as theirs.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
const run = async <T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> => (await (handlers[cap] as Fn)(ctx, input)) as T;
const agentFor = (w: ReturnType<typeof harness>, person?: string): Ctx => ({ ...w.ctx, principal: { kind: "agent", id: "agt_dex" }, origin: "agent", ...(person ? { actingFor: person } : {}) });
const text = { type: "text", props: { html: "<p>Hi</p>" } };

test("a block an agent saves for a person is that person's: they see it, change it, and nobody else sees it", async () => {
  const w = harness();   // usr_alex
  const dex = agentFor(w, "usr_alex");
  const saved = (await run<{ block: { blockId: string } }>(dex, "email_builder.saved_blocks.save", { name: "Dex's block", block: text })).block;
  assert.deepEqual((await run<{ blocks: Array<{ name: string }> }>(w.ctx, "email_builder.saved_blocks.list", {})).blocks.map((b) => b.name), ["Dex's block"], "the person sees it");
  await run(w.ctx, "email_builder.saved_blocks.save", { blockId: saved.blockId, name: "Renamed", block: text });
  assert.deepEqual((await run<{ blocks: Array<{ name: string }> }>(dex, "email_builder.saved_blocks.list", {})).blocks.map((b) => b.name), ["Renamed"], "the agent reads the person's library as the person");
  assert.deepEqual((await run<{ blocks: unknown[] }>(w.as("usr_ana"), "email_builder.saved_blocks.list", {})).blocks, [], "someone else does not");
  assert.deepEqual((await run<{ blocks: unknown[] }>(agentFor(w, "usr_ana"), "email_builder.saved_blocks.list", {})).blocks, [], "nor an agent acting for someone else");
});

test("a snippet an agent saves for a person is theirs to list, change and delete", async () => {
  const w = harness();
  const dex = agentFor(w, "usr_alex");
  const s = (await run<{ snippet: { snippetId: string } }>(dex, "email_builder.snippets.save", { name: "Thanks", body: "Thank you", shortcut: "ty" })).snippet;
  assert.equal((await run<{ snippets: unknown[] }>(w.ctx, "email_builder.snippets.list", {})).snippets.length, 1);
  await run(w.ctx, "email_builder.snippets.save", { snippetId: s.snippetId, name: "Thanks!", body: "Thank you" });
  assert.deepEqual(await run(dex, "email_builder.snippets.delete", { snippetId: s.snippetId }), { deleted: true });
});

test("a design an agent makes for a person is owned by that person; an agent acting for nobody still owns what it makes", async () => {
  const w = harness();
  await run(agentFor(w, "usr_alex"), "email_builder.create", { name: "Welcome", mode: "blocks" });
  await run(agentFor(w), "email_builder.create", { name: "Bare", mode: "blocks" });
  const owners = w.ctx.db.all("SELECT * FROM email_builder_api_email");
  assert.deepEqual(owners.map((r) => [r["name"], r["owner"]]).sort(), [["Bare", "agt_dex"], ["Welcome", "usr_alex"]]);
});
