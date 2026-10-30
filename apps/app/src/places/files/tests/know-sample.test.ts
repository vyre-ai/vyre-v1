// The Knowledge sample Space: the reads honour their inputs and the writes change the rows and the trail, so the screens' tests can lean on it.
import test from "node:test";
import assert from "node:assert/strict";
import { KNOW_NOW, createKnowSample, pageIdOf } from "../memory/sample-know.ts";

const read = <T>(s: ReturnType<typeof createKnowSample>, cap: string, input: unknown): T => {
  const snap = s.data.live(cap as never, input as never).getSnapshot();
  assert.equal(snap.status, "ready", cap);
  return (snap as { data: T }).data;
};

test("Learned lists current facts newest first, with their subject, source and who", () => {
  const s = createKnowSample();
  const out = read<{ items: Array<{ fact: { text: string; subject?: { title: string }; sourceTitle?: string }; actor: string }> }>(s, "memory.learned", { since: KNOW_NOW - 7 * 86_400_000 });
  assert.equal(out.items[0]!.fact.text, "Handles county records and conflict checks.");
  assert.equal(out.items[0]!.fact.subject?.title, "Lena Ortiz");
  assert.equal(out.items[0]!.fact.sourceTitle, "County records search");
  assert.ok(out.items.some((x) => x.actor === "upkeep"), "upkeep lines are in the feed");
});

test("a person page has its facts, its Notes with links and what mentions it", () => {
  const s = createKnowSample();
  const p = read<{ page: { title: string }; notes: string; facts: unknown[]; links: Array<{ title: string; pageId?: string }>; backlinks: unknown[] }>(s, "memory.page.get", { pageId: pageIdOf("ian") });
  assert.equal(p.page.title, "Ian Brooks");
  assert.equal(p.facts.length, 6);
  assert.deepEqual(p.links.map((l) => l.title), ["Brooks onboarding", "Assistant", "Client update cadence"]);
  assert.ok(p.links.every((l) => l.pageId));
  assert.ok(p.backlinks.length >= 2);
});

test("undo sends a fact to Trash, restore brings it back, and both are on the trail", async () => {
  const s = createKnowSample();
  const id = (read<{ items: Array<{ fact: { factId: string; text: string } }> }>(s, "memory.learned", {}).items.find((x) => x.fact.text === "Prefers updates on Fridays.")!).fact.factId;
  await s.data.call("memory.undo", { factId: id });
  assert.ok(!read<{ items: Array<{ fact: { factId: string } }> }>(s, "memory.learned", {}).items.some((x) => x.fact.factId === id));
  assert.ok(read<{ facts: Array<{ factId: string; trashReason?: string }> }>(s, "memory.trash.search", { area: "trash" }).facts.some((f) => f.factId === id && f.trashReason === "undone"));
  await s.data.call("memory.restore", { factId: id });
  assert.ok(read<{ items: Array<{ fact: { factId: string } }> }>(s, "memory.learned", {}).items.some((x) => x.fact.factId === id));
  const acts = read<{ rows: Array<{ action: string; factId?: string }> }>(s, "memory.trail", { factId: id }).rows.map((r) => r.action);
  assert.deepEqual(acts.slice(0, 2), ["restore", "undo"]);
});

test("the question about Ian's address resolves: one stays, the other goes to Trash", async () => {
  const s = createKnowSample();
  const q = read<{ questions: Array<{ questionId: string; facts: Array<{ factId: string; text: string }> }> }>(s, "memory.questions.list", { status: "open" }).questions[0]!;
  assert.equal(q.facts.length, 2);
  await s.data.call("memory.question.resolve", { questionId: q.questionId, resolution: "keep_b" });
  assert.equal(read<{ questions: unknown[] }>(s, "memory.questions.list", { status: "open" }).questions.length, 0);
  assert.ok(read<{ facts: Array<{ factId: string }> }>(s, "memory.trash.search", { area: "trash" }).facts.some((f) => f.factId === q.facts[0]!.factId));
});

test("Archive holds what stayed in Trash past the keep days, and a member cannot read it", () => {
  const s = createKnowSample();
  assert.equal(read<{ facts: unknown[] }>(s, "memory.trash.search", { area: "archive" }).facts.length, 2);
  assert.equal(read<{ facts: unknown[] }>(s, "memory.trash.search", { area: "trash" }).facts.length, 4);
  const m = createKnowSample({ member: true });
  assert.throws(() => m.data.live("memory.trash.search" as never, { area: "archive" } as never).getSnapshot(), /role_lacks_permission/);
});

test("the graph around Ian is ten nodes with labelled edges that carry the words and the chat they came from", () => {
  const s = createKnowSample();
  const g = read<{ nodes: unknown[]; edges: Array<{ label?: string; evidence?: string; source?: { title: string; link?: string } }> }>(s, "memory.graph", { scope: "space", focus: pageIdOf("ian"), hops: 2 });
  assert.equal(g.nodes.length, 10);
  const prefers = g.edges.find((e) => e.label === "prefers")!;
  assert.equal(prefers.evidence, "Ian told me today he prefers updates on Fridays.");
  assert.equal(prefers.source?.title, "Brooks weekly update");
  assert.ok(prefers.source?.link?.startsWith("vyre://thread/"));
});

test("Notes save as a new version, and a stale base version is refused", async () => {
  const s = createKnowSample();
  const pid = pageIdOf("ian");
  await s.data.call("memory.page.put", { pageId: pid, notes: "New notes with [[Maya Chen]].", baseVersion: 1 });
  await assert.rejects(() => s.data.call("memory.page.put", { pageId: pid, notes: "Stale.", baseVersion: 1 }), /precondition/);
  assert.equal(read<{ versions: number }>(s, "memory.page.get", { pageId: pid }).versions, 2);
});
