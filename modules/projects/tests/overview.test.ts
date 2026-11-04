// The Overview as a page (owner, 4 Nov 2026): an agent inserts a live invoices block; a member sees only the rows they may open plus a hidden count; undo restores; a template creates the right blocks;
// properties come from the records schema; every edit is audited by an event and an agent's edit leaves one quiet line in the channel.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, NOW, DANA, LEO, MAYA, BOT, contractErrors, harness, codeOf } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkProject, run } from "../fixtures/seed.ts";
import { BUILTIN_TEMPLATES, fromMarkdown, markdownOf, toMarkdown } from "../handlers/overview.ts";

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
  assert.match(h.only("chat.post")[0]!.input.body, /^Helper edited the Overview: added a live records block "Invoices"\.$/);
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

test("the editor's Markdown: every block is led by its id, a live block is one directive line, and saving it back keeps ids, authors and the page", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", after: "blk_h_next", block: { kind: "text", text: "Line one\n- a list\n- of things" } }] }, h.agent(BOT, DANA));
  const got = await run(h, "projects.overview_doc.get", { projectId: p.projectId });
  assert.match(got.markdown, /^<!--b:blk_status-->\n:::live \{"type":"status","spec":\{"title":"Status"\},"view":"list"\}\n\n<!--b:blk_h_next-->\n## Next\n\n<!--b:blk_[a-z0-9]+-->\nLine one/);
  assert.deepEqual(contractErrors("projects.overview_doc.get", "out", got), []);
  const same = await run(h, "projects.overview_doc.save", { projectId: p.projectId, markdown: got.markdown, baseRev: got.rev }, h.person(MAYA));
  assert.deepEqual(same.blocks.map((b: { id: string; by?: string }) => [b.id, b.by]), got.blocks.map((b: { id: string; by?: string }) => [b.id, b.by]), "nothing changed, so nobody is credited");
  assert.equal(same.markdown, got.markdown);
  // typing in the editor: a new paragraph with no marker is a new block by the saver; an edited paragraph keeps its id
  const typed = got.markdown.replace("## Next", "## Next up") + "\n\nA new paragraph typed in the editor\n";
  await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" });
  const saved = await run(h, "projects.overview_doc.save", { projectId: p.projectId, markdown: typed, baseRev: same.rev }, h.person(MAYA));
  const next = saved.blocks.find((b: { id: string }) => b.id === "blk_h_next");
  assert.deepEqual([next.text, next.by], ["Next up", MAYA]);
  assert.deepEqual([saved.blocks.at(-1).text, saved.blocks.at(-1).by], ["A new paragraph typed in the editor", MAYA]);
  assert.equal(saved.blocks.length, got.blocks.length + 1);
  // a block whose marker the editor dropped is a new block, the old one is gone
  const noMarkers = toMarkdown([{ id: "x", kind: "text", text: "Alone" }]).replace(/<!--b:x-->\n/, "");
  const parsed = fromMarkdown(h.ctx, noMarkers);
  assert.deepEqual(parsed.map((b) => [b.kind, b.text, b.fresh]), [["text", "Alone", true]]);
  // fenced code keeps its blank lines; a blank line after it splits; a bad live directive is refused
  const code = fromMarkdown(h.ctx, "<!--b:blk_c-->\n```js\na\n\nb\n```\n\nafter");
  assert.deepEqual(code.map((b) => [b.id, b.text, b.fresh]), [["blk_c", "```js\na\n\nb\n```", false], [code[1]!.id, "after", true]]);
  const split = fromMarkdown(h.ctx, "<!--b:blk_h-->\n## Title\n\nunmarked paragraph");
  assert.deepEqual(split.map((b) => [b.kind, b.text, b.fresh]), [["heading", "Title", false], ["text", "unmarked paragraph", true]]);
  // a list keeps its blank lines between items; a table is one block; a paragraph after a list is its own
  const mix = fromMarkdown(h.ctx, "<!--b:blk_l-->\n- one\n\n- two\n  more of two\n\nA paragraph\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.deepEqual(mix.map((b) => b.text), ["- one\n\n- two\n  more of two", "A paragraph", "| a | b |\n|---|---|\n| 1 | 2 |"]);
  assert.deepEqual(mix.map((b) => b.fresh), [false, true, true]);
  await refused(run(h, "projects.overview_doc.save", { projectId: p.projectId, markdown: "<!--b:blk_z-->\n:::live {not json}" }), "validation.bad_input");
  await refused(run(h, "projects.overview_doc.save", { projectId: p.projectId, markdown: '<!--b:blk_z-->\n:::live {"type":"weather","spec":{}}' }), "validation.bad_input");
});

test("projects.create with overviewTemplate starts the project on that page in one call; an unknown template is refused before anything is made", async () => {
  const h = harness();
  const made = await run(h, "projects.create", { type: "project", title: "Acme site", overviewTemplate: "tpl_software_project" });
  const spec = BUILTIN_TEMPLATES.find((t) => t.templateId === "tpl_software_project")!.blocks;
  const page = await run(h, "projects.overview_doc.get", { projectId: made.projectId });
  assert.equal(page.rev, 1);
  assert.deepEqual(page.blocks.map((b: { kind: string; live?: { type: string } }) => [b.kind, b.live?.type]), spec.map((b) => [b.kind, b.live?.type]));
  assert.equal(page.blocks.every((b: { by?: string }) => b.by === DANA), true);
  assert.equal((await run(h, "projects.overview_doc.history", { projectId: made.projectId })).revisions[0].summary, "started from the Software project template");
  assert.deepEqual(contractErrors("projects.create", "out", made), []);
  const before = h.world.channels.size;
  await refused(run(h, "projects.create", { type: "project", title: "Nope", overviewTemplate: "tpl_none" }), "validation.bad_input");
  assert.equal(h.world.channels.size, before, "nothing was made");
  // without one the project has the default page, unsaved
  const plain = await run(h, "projects.create", { type: "project", title: "Plain" });
  assert.equal((await run(h, "projects.overview_doc.get", { projectId: plain.projectId })).rev, 0);
  // a template saved since works the same way
  const saved = (await run(h, "projects.overview_doc.templates.save", { title: "Mine", projectId: made.projectId })).template;
  const again = await run(h, "projects.create", { type: "project", title: "From mine", overviewTemplate: saved.templateId });
  assert.equal((await run(h, "projects.overview_doc.get", { projectId: again.projectId })).blocks.length, spec.length);
});

test("tasks the reader may not open are counted: rows through the reader's access, the total from an unscoped count, and the difference is hidden", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.task(p, { title: "Open to all", due: NOW + DAY });
  h.task(p, { title: "Also open", due: NOW + 2 * DAY });
  let asked: unknown;
  h.world.handlers["records.counts"] = (i) => { asked = i; return { count: i.type === "task" ? 5 : 0 }; };
  const t = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "tasks", spec: {} });
  assert.deepEqual([t.rows.length, t.hidden, t.total], [2, 3, 5]);
  assert.deepEqual(asked, { type: "task", filter: { field: "project", op: "eq", value: p.recordId } });
  const m = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "milestones", spec: {} });
  assert.equal(m.hidden, 3);
  // a count that cannot be read hides nothing rather than guessing
  h.world.down.add("records.counts");
  assert.equal((await run(h, "projects.live_block.query", { projectId: p.projectId, type: "tasks", spec: {} })).hidden, 0);
  // the Client account template's unpaid sum filters in the records grammar
  const filter = BUILTIN_TEMPLATES.find((x) => x.templateId === "tpl_client_account")!.blocks.find((b) => b.id === "b_owed")!.live!.spec["filter"];
  assert.deepEqual(filter, { field: "status", op: "eq", value: "sent" });
});

test("the goal block reads the project's goal text and the goals of the project", async () => {
  const h = harness();
  const p = await mkProject(h, { goal: "Sign the letter" });
  h.world.handlers["goals.list"] = (i) => ({ goals: i.scope === "project" && i.projectId === p.projectId ? [{ id: "gol_1", title: "300 registrations", status: "active" }] : [] });
  const out = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "goal", spec: {} });
  assert.deepEqual(out.rows.map((r: { title: string; state?: string }) => [r.title, r.state]), [["Sign the letter", undefined], ["300 registrations", "active"]]);
  assert.deepEqual(contractErrors("projects.live_block.query", "out", out), []);
});

test("two paragraphs typed in the editor are two blocks; editing the second leaves the first with its author and its id", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" });
  const opened = await run(h, "projects.overview_doc.get", { projectId: p.projectId });
  const typed = `${opened.markdown}\n\nFirst paragraph\n\nSecond paragraph\n`;
  const first = await run(h, "projects.overview_doc.save", { projectId: p.projectId, markdown: typed, baseRev: opened.rev });
  const [a, b] = first.blocks.slice(-2);
  assert.deepEqual([first.blocks.length, a.text, b.text, a.by, b.by], [opened.blocks.length + 2, "First paragraph", "Second paragraph", DANA, DANA]);
  assert.notEqual(a.id, b.id);
  // Maya opens the page and changes only the second paragraph
  h.advance(60_000);
  const reopened = await run(h, "projects.overview_doc.get", { projectId: p.projectId });
  const edited = reopened.markdown.replace("Second paragraph", "Second paragraph, rewritten");
  const second = await run(h, "projects.overview_doc.save", { projectId: p.projectId, markdown: edited, baseRev: reopened.rev }, h.person(MAYA));
  const [a2, b2] = second.blocks.slice(-2);
  assert.deepEqual([a2.id, a2.by, a2.at], [a.id, DANA, a.at], "the paragraph that did not change keeps its id, author and time");
  assert.deepEqual([b2.id, b2.text, b2.by], [b.id, "Second paragraph, rewritten", MAYA], "the edited one keeps its id and takes the editor as author");
  assert.equal(second.blocks.length, first.blocks.length);
});

test("goals the reader may not open are counted through goals.count: the difference from what goals.list shows is hidden", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.world.handlers["goals.list"] = () => ({ goals: [{ id: "gol_1", title: "Open goal", status: "active" }] });
  let asked: unknown;
  h.world.handlers["goals.count"] = (i) => { asked = i; return { count: 4 }; };
  const out = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "goal", spec: {} });
  assert.deepEqual([out.rows.length, out.hidden, out.total], [1, 3, 4]);
  assert.deepEqual(asked, { projectId: p.projectId });
  assert.equal(JSON.stringify(out).includes("gol_2"), false);
  h.world.down.add("goals.count");
  assert.equal((await run(h, "projects.live_block.query", { projectId: p.projectId, type: "goal", spec: {} })).hidden, 0, "a reader who may not ask is told nothing hidden, not a guess");
});

test("a save says what it changed, an agent's block is named with its title, and an older version can be restored as a new one", async () => {
  const { describeChange } = await import("../handlers/overview.ts");
  const live = (id: string, title: string, status: string, view?: string) => ({ id, kind: "live" as const, live: { type: "tasks" as const, spec: { title, status }, ...(view ? { view: view as "list" } : {}) } });
  assert.equal(describeChange([live("a", "Open tasks", "open")], [live("a", "Open tasks", "late")]), "changed the filter of Open tasks");
  assert.equal(describeChange([live("a", "Open tasks", "open")], [live("a", "Open tasks", "open", "table")]), "changed the view of Open tasks");
  assert.equal(describeChange([], [live("b", "Late work", "late")]), 'added a live tasks block "Late work"');
  assert.equal(describeChange([live("b", "Late work", "late")], []), 'removed a live tasks block "Late work"');
  assert.equal(describeChange([{ id: "t", kind: "text", text: "a" }], [{ id: "t", kind: "text", text: "b" }]), "edited a paragraph");
  const h = harness();
  const p = await mkProject(h);
  const one = await run(h, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "First" } }] });
  const first = { rev: one.rev as number };
  await run(h, "projects.overview_edit", { projectId: p.projectId, baseRev: first.rev, ops: [{ op: "insert", block: { kind: "text", text: "Added later" } }] });
  const second = await run(h, "projects.overview_doc.get", { projectId: p.projectId });
  assert.ok(second.markdown.includes("Added later"));
  const back = await run(h, "projects.overview_doc.restore", { projectId: p.projectId, rev: first.rev, baseRev: second.rev });
  assert.equal(back.restored, first.rev);
  const now = await run(h, "projects.overview_doc.get", { projectId: p.projectId });
  assert.ok(!now.markdown.includes("Added later"), "the older page is back");
  assert.equal(now.latest.summary, `restored version ${first.rev}`);
  assert.equal(now.rev, back.rev, "the restore is a revision of its own");
  await refused(run(h, "projects.overview_doc.restore", { projectId: p.projectId, rev: 999 }), "validation.not_found");
  await refused(run(h, "projects.overview_doc.restore", { projectId: p.projectId, rev: first.rev, baseRev: second.rev }), "validation.precondition_failed");
});

test("a tasks block can show what is waiting, and what is assigned to the reader (assigned: me)", async () => {
  const h = harness();
  const p = await mkProject(h);
  const waiting = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "tasks", spec: { status: "waiting" } });
  assert.equal(waiting.type, "tasks");
  const mine = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "tasks", spec: { status: "all", assigned: "me" } });
  assert.ok(Array.isArray(mine.rows));
});

test("a metric that sums a money field adds the amounts, whether the field holds a number or { amount, currency }, and says the currency", async () => {
  const h = harness();
  const p = await mkProject(h);
  const money = [
    { id: "m1", fields: { number: "A", status: "sent", amount: { amount: 1200, currency: "USD" } }, openTo: [DANA] },
    { id: "m2", fields: { number: "B", status: "sent", amount: { amount: 800.5, currency: "USD" } }, openTo: [DANA] },
    { id: "m3", fields: { number: "C", status: "sent", amount: 99 }, openTo: [DANA] },
  ];
  invoices(h, money);
  const out = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "metric", spec: { title: "Unpaid", type: "invoice", op: "sum", field: "amount" } });
  assert.equal(out.value, 2099.5, "a money value is its amount, not NaN or 0");
  assert.equal(out.unit, "USD");
  assert.deepEqual(contractErrors("projects.live_block.query", "out", out), []);
  const count = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "metric", spec: { title: "Invoices", type: "invoice", op: "count" } });
  assert.equal(count.value, 3);
  assert.equal(count.unit, undefined);
});

test("amounts in different currencies are never added together: the metric answers one total per currency", async () => {
  const h = harness();
  const p = await mkProject(h);
  const mixed = [
    { id: "x1", fields: { number: "A", status: "sent", amount: { amount: 3000, currency: "USD" } }, openTo: [DANA] },
    { id: "x2", fields: { number: "B", status: "sent", amount: { amount: 1550, currency: "USD" } }, openTo: [DANA] },
    { id: "x3", fields: { number: "C", status: "sent", amount: { amount: 900, currency: "EUR" } }, openTo: [DANA] },
  ];
  invoices(h, mixed);
  const out = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "metric", spec: { title: "Unpaid", type: "invoice", op: "sum", field: "amount" } });
  assert.equal(out.value, undefined, "no single number when there is more than one currency");
  assert.equal(out.unit, undefined);
  assert.deepEqual(out.parts, [{ unit: "USD", value: 4550 }, { unit: "EUR", value: 900 }]);
  assert.equal(out.total, 3);
  assert.deepEqual(contractErrors("projects.live_block.query", "out", out), []);
  // one currency: one number, as before
  invoices(h, mixed.slice(0, 2));
  const one = await run(h, "projects.live_block.query", { projectId: p.projectId, type: "metric", spec: { title: "Unpaid", type: "invoice", op: "sum", field: "amount" } });
  assert.deepEqual([one.value, one.unit, one.parts], [4550, "USD", undefined]);
});
