// The memory guide in an agent's folder: CLAUDE.md and AGENTS.md carry the same text, made from MAP.md, and follow it when the nightly job rewrites it; a file somebody else wrote is left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { syncMemoryGuide } from "../memory-guide.ts";
import { GUIDE_FILES, GUIDE_MARK, isGuide, memoryGuide } from "../../../lib/memory-guide.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
async function setup(map: { body: string } | null = { body: "# Memory map\n- first" }) {
  const hn = harness();
  const agent = (await h["agents.create"]!(hn.ctx, { name: "Intake", role: "Use me when a new client form arrives.", idempotencyKey: `mg${++n}` })).agent;
  let current = map;
  hn.world.answer("memory.map.get", () => (current ? { map: current } : {}));
  return { hn, agent, setMap(b: string | null) { current = b === null ? null : { body: b }; } };
}
const text = (hn: Harness, folderId: string, name: string): string | undefined => { const f = hn.world.fileIn(folderId, name); return f ? hn.world.text(f.fileId) : undefined; };

test("the guide holds the map and the tools; both file names get the same text", () => {
  const g = memoryGuide("Intake", "# Memory map\n- Billing (notes/billing.md)");
  assert.ok(g.startsWith(GUIDE_MARK) && isGuide(g));
  for (const t of ["memory_search", "memory_quote", "memory_remember", "memory_forget"]) assert.ok(g.includes(t), t);
  assert.ok(g.includes("- Billing (notes/billing.md)"));
  assert.deepEqual([...GUIDE_FILES], ["CLAUDE.md", "AGENTS.md"]);
  assert.ok(memoryGuide("Intake", null).includes("empty until the first night"));
  assert.ok(!isGuide("# my own CLAUDE.md"));
});

test("sync writes CLAUDE.md and AGENTS.md from MAP.md, follows a new map, and does nothing when the map is the same", async () => {
  const { hn, agent, setMap } = await setup();
  assert.deepEqual(await syncMemoryGuide(hn.ctx, { agentId: agent.agentId }), ["CLAUDE.md", "AGENTS.md"]);
  const a = text(hn, agent.folderId, "CLAUDE.md")!;
  assert.equal(a, text(hn, agent.folderId, "AGENTS.md"));
  assert.equal(a, memoryGuide("Intake", "# Memory map\n- first"));
  assert.deepEqual(await syncMemoryGuide(hn.ctx, { agentId: agent.agentId }), [], "an unchanged map writes nothing");
  setMap("# Memory map\n- second");
  assert.deepEqual(await syncMemoryGuide(hn.ctx, { agentId: agent.agentId }), ["CLAUDE.md", "AGENTS.md"]);
  assert.ok(text(hn, agent.folderId, "AGENTS.md")!.includes("- second") && !text(hn, agent.folderId, "AGENTS.md")!.includes("- first"));
  assert.equal(hn.world.fileIn(agent.folderId, "CLAUDE.md")!.versions.length, 2, "the old guide is a version, not lost");
});

test("a file called CLAUDE.md that somebody else made is left alone, and AGENTS.md is still written", async () => {
  const { hn, agent } = await setup();
  const made = await hn.world.handlers["files.create"]!({ folderId: agent.folderId, name: "CLAUDE.md", content: { text: "# My own notes for Claude" } });
  assert.ok(made);
  assert.deepEqual(await syncMemoryGuide(hn.ctx, { agentId: agent.agentId }), ["AGENTS.md"]);
  assert.equal(text(hn, agent.folderId, "CLAUDE.md"), "# My own notes for Claude");
});

test("no map yet, a map the caller cannot read, or an unknown agent writes nothing and does not throw", async () => {
  const { hn, agent, setMap } = await setup(null);
  assert.deepEqual(await syncMemoryGuide(hn.ctx, { agentId: agent.agentId }), []);
  assert.deepEqual(await syncMemoryGuide(hn.ctx, { agentId: "agt_nobody" }), []);
  hn.world.answer("memory.map.get", () => { throw new Error("no"); });
  setMap("# Memory map");
  assert.deepEqual(await syncMemoryGuide(hn.ctx, { agentId: agent.agentId }), []);
  assert.equal(hn.world.fileIn(agent.folderId, "CLAUDE.md"), undefined);
});
