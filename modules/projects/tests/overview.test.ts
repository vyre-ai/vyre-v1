// The Overview as a page (owner, 4 Nov 2026): an agent inserts a live invoices block; a member sees only the rows they may open plus a hidden count; undo restores; a template creates the right blocks;
// properties come from the records schema; every edit is audited by an event and an agent's edit leaves one quiet line in the channel.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, NOW, DANA, LEO, MAYA, BOT, contractErrors, harness, codeOf } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkProject, run } from "../fixtures/seed.ts";
import { BUILTIN_TEMPLATES, markdownOf } from "../handlers/overview.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}

/** Invoices as the records module answers them: the asker sees the rows they may open, and `counts` is every row of the type. */
const who = { id: DANA };
function invoices(h: Harness, all: Array<{ id: string; fields: Record<string, unknown>; openTo: string[] }>) {
  who.id = DANA;
  h.world.handlers["records.query"] = (i) => {
    const w = who.id;
    return { rows: all.filter((r) => i.type === "invoice" && r.openTo.includes(w)).map((r) => ({ id: r.id, type: "invoice", version: 1, label: 0, fields: r.fields, createdAt: NOW, updatedAt: NOW, holds: 0 })) , total: all.filter((r) => r.openTo.includes(w)).length };
  };
  h.world.handlers["records.counts"] = (i) => ({ count: all.filter(() => i.type === "invoice").length });
}
const INV = [
  { id: "rec_i1", fields: { number: "INV-1", status: "sent", amount: 100 }, openTo: [DANA, LEO] },
  { id: "rec_i2", fields: { number: "INV-2", status: "paid", amount: 250 }, openTo: [DANA, LEO] },
  { id: "rec_i3", fields: { number: "INV-3", status: "sent", amount: 900 }, openTo: [DANA] },
];

test("an agent inserts a live invoices block; a member sees only the invoices they may open and how many they may not", async () => {
  const h = harness();
  invoices(h, INV);
  const p = await mkProject(h);
  await run(h, "projects.members.set", { projectId: p.projectId, principal: BOT, role: "member" });
  await run(h, "projects.members.set", { projectId: p.projectId, principal: LEO, role: "member" });
  const bot = h.agent(BOT, DANA);
  h.clear();
  const out = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", after: "start", block: { kind: "live", live: { type: "records", spec: { type: "invoice", title: "Invoices" }, view: "table" } } }] }, bot);
  assert.equal(out.rev, 1);
  const block = out.blocks[0];
  assert.deepEqual([block.kind, block.live.type, block.by], ["live", "records", DANA]);
  assert.equal(out.blocks.length, defaultCount() + 1);
  assert.deepEqual(contractErrors("projects.overview_edit", "out", out), []);
  // the page stores the spec and never the rows
  const stored = h.rows("SELECT blocks FROM projects_doc WHERE projectId = ?", p.projectId)[0]!["blocks"] as string;
  assert.ok(stored.includes('"type":"invoice"') && !stored.includes("INV-1"), "only the spec is stored");
  // an event, an audit trail by revision, and one quiet line in the channel
  const ev = h.named("project.overview_edited");
  assert.deepEqual(ev.map((e) => [e.payload["authorKind"], e.payload["rev"]]), [["agent", 1]]);
  assert.equal(h.only("chat.post").length, 1);
  assert.match(h.only("chat.post")[0]!.input.body, /^Helper edited the Overview: added a live records block\.$/);
  // Dana opens every invoice; Leo, two of three
  const asDana = await run(h, "projects.live_block.query", { projectId: p.projectId, blockId: block.id });
  assert.deepEqual([asDana.rows.length, asDana.hidden, asDana.total], [3, 0, 3]);
  who.id = LEO;
  const asLeo = await run(h, "projects.live_block.query", { projectId: p.projectId, blockId: block.id }, h.person(LEO));
  assert.deepEqual([asLeo.rows.map((r: { title: string }) => r.title), asLeo.hidden, asLeo.total], [["INV-1", "INV-2"], 1, 3]);
  assert.deepEqual(contractErrors("projects.live_block.query", "out", asLeo), []);
  assert.equal(JSON.stringify(asLeo).includes("INV-3"), false, "the row they may not open is not in the answer");
});
const defaultCount = (): number => 7;

test("undo puts the page back, then the undo can be undone; only the latest change is undone", async () => {
  const h = harness();
  const p = await mkProject(h);
  const before = (await run(h, "projects.overview_doc.get", { projectId: p.projectId })).blocks;
  const a = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "Kickoff notes" } }] });
  const b = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "delete", id: "blk_h_next" }] });
  assert.equal(b.blocks.length, a.blocks.length - 1);
  await refused(run(h, "projects.overview_doc.undo", { projectId: p.projectId, rev: a.rev }), "validation.precondition_failed");
  const undone = await run(h, "projects.overview_doc.undo", { projectId: p.projectId });
  assert.deepEqual([undone.rev, undone.undid], [3, 2]);
  assert.deepEqual(undone.blocks.map((x: { id: string }) => x.id), a.blocks.map((x: { id: string }) => x.id));
  const undoAgain = await run(h, "projects.overview_doc.undo", { projectId: p.projectId });
  assert.deepEqual(undoAgain.blocks.map((x: { id: string }) => x.id), b.blocks.map((x: { id: string }) => x.id), "an undo can be undone");
  const hist = await run(h, "projects.overview_doc.history", { projectId: p.projectId });
  assert.deepEqual(hist.revisions.map((r: { rev: number; undoOf?: number }) => [r.rev, r.undoOf]), [[4, 3], [3, 2], [2, undefined], [1, undefined]]);
  assert.deepEqual(contractErrors("projects.overview_doc.history", "out", hist), []);
  const fresh = harness();
  const q = await mkProject(fresh);
  await refused(run(fresh, "projects.overview_doc.undo", { projectId: q.projectId }), "validation.precondition_failed");
  assert.equal(before.length, 7);
});

test("ops: insert after a block, update, move and delete; a bad op or block is refused and changes nothing", async () => {
  const h = harness();
  const p = await mkProject(h);
  const r1 = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [
    { op: "insert", after: "blk_status", block: { kind: "heading", text: "Plan", level: 1 } },
    { op: "insert", after: "end", block: { kind: "text", text: "Last words" } },
  ] });
  const ids = r1.blocks.map((b: { id: string }) => b.id);
  assert.equal(ids[1] !== "blk_h_next" && r1.blocks[1].text === "Plan", true);
  assert.equal(r1.blocks.at(-1).text, "Last words");
  const last = r1.blocks.at(-1).id;
  const r2 = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "update", id: last, block: { text: "Final words" } }, { op: "move", id: last, after: "start" }] });
  assert.deepEqual([r2.blocks[0].id, r2.blocks[0].text], [last, "Final words"]);
  const r3 = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "update", id: "blk_next", block: { live: { type: "milestones", spec: { limit: 5 } } } }] });
  assert.equal(r3.blocks.find((b: { id: string }) => b.id === "blk_next").live.spec.limit, 5);
  const revBefore = (await run(h, "projects.overview_doc.get", { projectId: p.projectId })).rev;
  for (const [ops, code] of [
    [[{ op: "delete", id: "blk_nope" }], "validation.not_found"],
    [[{ op: "teleport" }], "validation.bad_input"],
    [[{ op: "insert", block: { kind: "live", live: { type: "weather", spec: {} } } }], "validation.bad_input"],
    [[{ op: "insert", block: { kind: "live", live: { type: "records", spec: {} } } }], "validation.bad_input"],
    [[{ op: "insert", block: { kind: "live", live: { type: "metric", spec: { type: "invoice", op: "average" } } } }], "validation.bad_input"],
    [[{ op: "insert", block: { kind: "text" } }], "validation.bad_input"],
    [[], "validation.bad_input"],
  ] as const) await refused(run(h, "projects.overview_edit", { projectId: p.projectId, ops }), code);
  assert.equal((await run(h, "projects.overview_doc.get", { projectId: p.projectId })).rev, revBefore, "nothing was saved");
});

test("a page changed since it was opened is not overwritten: the second writer is told", async () => {
  const h = harness();
  const p = await mkProject(h);
  const opened = await run(h, "projects.overview_doc.get", { projectId: p.projectId });
  await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "A" } }], baseRev: opened.rev });
  await refused(run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "B" } }], baseRev: opened.rev }), "validation.precondition_failed");
  await refused(run(h, "projects.overview_doc.save", { projectId: p.projectId, blocks: [], baseRev: opened.rev }), "validation.precondition_failed");
});

test("save from the editor keeps the author of blocks that did not change and credits the rest to the saver", async () => {
  const h = harness();
  const p = await mkProject(h);
  const first = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "Agent wrote this" } }] }, h.agent(BOT, DANA));
  await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" });
  h.advance(60_000);
  const blocks = first.blocks.map((b: Record<string, unknown>) => (b["text"] === "Agent wrote this" ? b : b));
  blocks.push({ kind: "text", text: "Maya added this" });
  const saved = await run(h, "projects.overview_doc.save", { projectId: p.projectId, blocks, baseRev: first.rev }, h.person(MAYA));
  const mine = saved.blocks.at(-1);
  assert.deepEqual([mine.text, mine.by], ["Maya added this", MAYA]);
  assert.equal(saved.blocks.find((b: { text?: string }) => b.text === "Agent wrote this").at, NOW, "unchanged block keeps its time");
  assert.deepEqual(contractErrors("projects.overview_doc.save", "out", saved), []);
});

test("properties: the project's custom fields from the records schema show in the page, and set_property writes one, undoably", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.world.handlers["schema.types.get"] = () => ({ type: { key: "project", fields: [{ key: "title", title: "Name", type: "text" }, { key: "status", title: "Status", type: "status" }, { key: "client", title: "Client", type: "text" }, { key: "budget", title: "Budget", type: "number" }] } });
  h.world.records.get(p.recordId)!.fields["client"] = "Rivera";
  const got = await run(h, "projects.overview_doc.get", { projectId: p.projectId });
  assert.deepEqual(got.properties, [{ key: "client", title: "Client", type: "text", value: "Rivera" }, { key: "budget", title: "Budget", type: "number" }]);
  assert.deepEqual(contractErrors("projects.overview_doc.get", "out", got), []);
  const out = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "set_property", key: "client", value: "Rivera & Sons" }, { op: "set_property", key: "budget", value: 5000 }] });
  assert.equal(h.world.records.get(p.recordId)!.fields["client"], "Rivera & Sons");
  assert.match(out.summary, /set Client, set Budget/);
  await refused(run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "set_property", key: "status", value: "done" }] }), "validation.bad_input");
  await refused(run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "set_property", key: "nope", value: 1 }] }), "validation.bad_input");
  await run(h, "projects.overview_doc.undo", { projectId: p.projectId });
  assert.deepEqual([h.world.records.get(p.recordId)!.fields["client"], h.world.records.get(p.recordId)!.fields["budget"]], ["Rivera", undefined]);
});

test("templates: Client account, Software project and Hiring are seeded; applying one creates its blocks; undo brings the old page back; an agent can save a new one", async () => {
  const h = harness();
  const p = await mkProject(h);
  const list = await run(h, "projects.overview_doc.templates.list", {});
  assert.deepEqual(list.templates.map((t: { title: string }) => t.title), ["Client account", "Software project", "Hiring"]);
  assert.equal(list.templates.every((t: { builtin: boolean }) => t.builtin), true);
  assert.deepEqual(contractErrors("projects.overview_doc.templates.list", "out", list), []);
  const out = await run(h, "projects.overview_doc.apply_template", { projectId: p.projectId, templateId: "tpl_software_project" });
  const spec = BUILTIN_TEMPLATES.find((t) => t.templateId === "tpl_software_project")!.blocks;
  assert.deepEqual(out.blocks.map((b: { kind: string; live?: { type: string } }) => [b.kind, b.live?.type]), spec.map((b) => [b.kind, b.live?.type]));
  assert.equal(out.blocks.some((b: { live?: { type: string; spec: { kind?: string } } }) => b.live?.type === "links" && b.live.spec.kind === "github.pr"), true);
  assert.equal(out.blocks.some((b: { live?: { type: string } }) => b.live?.type === "ci"), true);
  assert.equal(new Set(out.blocks.map((b: { id: string }) => b.id)).size, out.blocks.length, "fresh ids");
  const client = await run(h, "projects.overview_doc.apply_template", { projectId: p.projectId, templateId: "tpl_client_account" });
  assert.equal(client.blocks.some((b: { live?: { type: string; spec: { type?: string } } }) => b.live?.type === "records" && b.live.spec.type === "invoice"), true);
  const hiring = await run(h, "projects.overview_doc.apply_template", { projectId: p.projectId, templateId: "tpl_hiring" });
  assert.equal(hiring.blocks.some((b: { live?: { type: string; spec: { type?: string } } }) => b.live?.type === "records" && b.live.spec.type === "candidate"), true);
  const back = await run(h, "projects.overview_doc.undo", { projectId: p.projectId });
  assert.deepEqual(back.blocks.map((b: { id: string }) => b.id), client.blocks.map((b: { id: string }) => b.id));
  await refused(run(h, "projects.overview_doc.apply_template", { projectId: p.projectId, templateId: "tpl_none" }), "validation.not_found");
  // an agent saves the page it built as a template; a built-in cannot be overwritten
  await run(h, "projects.members.set", { projectId: p.projectId, principal: BOT, role: "member" });
  const saved = await run(h, "projects.overview_doc.templates.save", { title: "Retainer client", summary: "For retainer clients", projectId: p.projectId }, h.agent(BOT, DANA));
  assert.deepEqual([saved.template.title, saved.template.builtin, saved.template.by], ["Retainer client", false, DANA]);
  assert.deepEqual(contractErrors("projects.overview_doc.templates.save", "out", saved), []);
  const q = await mkProject(h, { title: "Second" });
  const applied = await run(h, "projects.overview_doc.apply_template", { projectId: q.projectId, templateId: saved.template.templateId });
  assert.equal(applied.blocks.length, client.blocks.length);
  await refused(run(h, "projects.overview_doc.templates.save", { title: "Mine", templateId: "tpl_hiring", projectId: p.projectId }), "validation.bad_input");
  await refused(run(h, "projects.overview_doc.templates.save", { title: " ", projectId: p.projectId }), "validation.bad_input");
});

test("overview_get gives the page as Markdown with every block's id, for an agent to name what to change", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", after: "blk_status", block: { kind: "live", live: { type: "links", spec: { kind: "github.pr", title: "PRs" }, view: "list" } } }, { op: "insert", block: { kind: "text", text: "Hello **team**" } }] });
  const out = await run(h, "projects.overview_get", { projectId: p.projectId });
  assert.match(out.markdown, /^\[blk_status\] :::live status \{"title":"Status"\}/);
  assert.match(out.markdown, /\[blk_[a-z0-9]+\] :::live links \{"kind":"github.pr","title":"PRs"\} view=list/);
  assert.match(out.markdown, /\[blk_h_next\] ## Next/);
  assert.match(out.markdown, /Hello \*\*team\*\*$/);
  assert.deepEqual(out.liveTypes, ["tasks", "milestones", "links", "records", "metric", "ci", "goal", "people", "status"]);
  assert.deepEqual(contractErrors("projects.overview_get", "out", out), []);
  assert.equal(markdownOf([]), "");
});

test("each kind of live block evaluates through the reader: tasks, milestones, links, ci, metric, goal, people and status", async () => {
  const h = harness();
  const p = await mkProject(h, { goal: "Sign the letter" });
  h.task(p, { title: "Late one", due: NOW - DAY, start: NOW - 3 * DAY });
  h.task(p, { title: "Next one", due: NOW + 2 * DAY, start: NOW + DAY });
  h.task(p, { title: "Kickoff", due: NOW + 3 * DAY, start: NOW + 3 * DAY });
  h.task(p, { title: "Finished", due: NOW - 5 * DAY, state: "done" });
  invoices(h, INV);
  await run(h, "projects.links.link", { projectId: p.projectId, kind: "url", ref: "https://example.com/a", label: "A" });
  await run(h, "projects.links.link", { projectId: p.projectId, kind: "ci.run", ref: "cir_1", state: "Passed", label: "build" });
  const q = (type: string, spec: Record<string, unknown> = {}, ctx = h.ctx) => run(h, "projects.live_block.query", { projectId: p.projectId, type, spec }, ctx);
  assert.deepEqual((await q("tasks", { status: "late" })).rows.map((r: { title: string }) => r.title), ["Late one"]);
  assert.deepEqual((await q("tasks", {})).rows.map((r: { title: string }) => r.title), ["Late one", "Next one", "Kickoff"]);
  assert.deepEqual((await q("tasks", { status: "done" })).rows.map((r: { title: string }) => r.title), ["Finished"]);
  assert.deepEqual((await q("milestones")).rows.map((r: { title: string }) => r.title), ["Kickoff"]);
  assert.deepEqual((await q("links", { kind: "url" })).rows.map((r: { title: string }) => r.title), ["A"]);
  assert.deepEqual((await q("ci")).rows.map((r: { title: string; state?: string }) => [r.title, r.state]), [["build", "Passed"]]);
  const sum = await q("metric", { type: "invoice", op: "sum", field: "amount" });
  assert.deepEqual([sum.value, sum.hidden], [1250, 0]);
  who.id = LEO;
  const asLeo = await q("metric", { type: "invoice", op: "sum", field: "amount" }, h.person(LEO));
  who.id = DANA;
  assert.deepEqual([asLeo.value, asLeo.hidden, asLeo.total], [350, 1, 3], "a sum counts only the rows the reader may open");
  assert.equal((await q("metric", { type: "invoice", op: "count" })).value, 3);
  assert.deepEqual((await q("goal")).rows.map((r: { title: string }) => r.title), ["Sign the letter"]);
  assert.equal((await q("people")).rows.length, 1);
  const st = await q("status");
  assert.match(st.rows[0].detail, /3 open, 1 late/);
  // a source that is down leaves the block empty, not the page failed
  h.world.down.add("records.query");
  assert.deepEqual((await q("records", { type: "invoice" })).rows, []);
  await refused(q("records", {}), "validation.bad_input");
  await refused(run(h, "projects.live_block.query", { projectId: p.projectId, blockId: "blk_none" }), "validation.not_found");
});

test("reading the page needs view; changing it needs edit; a project the caller cannot see is not there", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.allowOnly((a) => a.level === "view");
  assert.equal((await run(h, "projects.overview_doc.get", { projectId: p.projectId })).rev, 0);
  await refused(run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "delete", id: "blk_status" }] }), "permission.no_grant");
  await refused(run(h, "projects.overview_doc.undo", { projectId: p.projectId }), "permission.no_grant");
  await refused(run(h, "projects.overview_doc.apply_template", { projectId: p.projectId, templateId: "tpl_hiring" }), "permission.no_grant");
  h.allowOnly(() => false);
  await refused(run(h, "projects.overview_doc.get", { projectId: p.projectId }), "validation.not_found");
  await refused(run(h, "projects.overview_get", { projectId: p.projectId }), "validation.not_found");
});
