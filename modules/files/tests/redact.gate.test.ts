// Redaction for AI, the files half of the read gate (host/src/seams/agent-read.ts asks it for every call an agent is behind): Agent access inherited down the tree, the layer, review, requests,
// re-anchoring, and every content and name path refusing or redacting. Each test shows the original text never reaches an agent in a Redacted or Not available folder.
// @reads /modules/files/handlers/redact.ts
// @reads /modules/files/migrations/0006_redaction.sql
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { agentGate } from "../handlers/redact.ts";
import { redactWorld, INTAKE, SECRETS } from "../fixtures/redact-world.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const AGENT = { principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", thread: "thr_1" };

async function claim() {
  const w = redactWorld(new DatabaseSync(":memory:"));
  const r = await w.roots();
  const claimId = await w.folder(r["projects"]!, "Rivera injury claim");
  const med = await w.folder(claimId, "Medical records");
  const bill = await w.folder(claimId, "Billing");
  const intake = await w.file(claimId, "Rivera intake form.txt", INTAKE);
  const retainer = await w.file(claimId, "Rivera retainer.txt", "Retainer between Northwind and Elena Rivera. Trust account 4471-0098-2216.");
  const er = await w.file(med, "ER record.txt", "Patient Elena Rivera. MRN 00-4471882.");
  const costs = await w.file(bill, "case-costs.csv", "Item,Amount\nMRI films,$30\n", "text/csv");
  const open = await w.file(r["projects"]!, "public-notes.txt", "Nothing secret here. Elena Rivera is a client.");
  const ctx = w.irfad;
  await w.call(ctx, "files.agent_access.set", { target: { type: "folder", id: claimId }, value: "redact" });
  await w.call(ctx, "files.agent_access.set", { target: { type: "folder", id: bill }, value: "off" });
  return { w, ctx, root: r["projects"]!, claimId, med, bill, intake, retainer, er, costs, open };
}
const gate = (w: ReturnType<typeof redactWorld>, cap: string, input: Obj, output: Obj, who: Obj = AGENT, phase = "after") => agentGate(w.ctxFor({ kind: "service", id: "svc_host" }), { phase, cap, input, output, who }) as Promise<Obj>;
const readRaw = async (w: ReturnType<typeof redactWorld>, fileId: string, extra: Obj = {}) => w.call(w.irfad, "files.read", { fileId, as: "text", ...extra });
const noSecret = (v: unknown) => { const s = JSON.stringify(v); for (const x of SECRETS) assert.ok(!s.includes(x), `${x} reached the agent: ${s.slice(0, 300)}`); };

test("Agent access is inherited down the tree and a subfolder or file can set its own; people read everything as it is", async () => {
  const c = await claim();
  const at = (t: Obj) => c.w.call(c.ctx, "files.agent_access.get", { target: t });
  assert.equal((await at({ type: "folder", id: c.claimId })).value, "redact");
  assert.equal((await at({ type: "folder", id: c.med })).value, "redact", "Medical records inherits Redacted");
  assert.equal((await at({ type: "folder", id: c.med })).from.name, "Rivera injury claim");
  assert.equal((await at({ type: "folder", id: c.bill })).value, "off");
  assert.equal((await at({ type: "file", id: c.costs })).value, "off");
  const top = await at({ type: "folder", id: c.claimId });
  assert.deepEqual(top.overrides.map((o: Obj) => [o.name, o.value]), [["Billing", "off"]]);
  assert.equal(top.inherited, "on", "Projects is Available");
  await c.w.call(c.ctx, "files.agent_access.set", { target: { type: "file", id: c.er }, value: "off" });
  assert.equal((await at({ type: "file", id: c.er })).value, "off");
  await c.w.call(c.ctx, "files.agent_access.set", { target: { type: "file", id: c.er }, value: null });
  assert.equal((await at({ type: "file", id: c.er })).value, "redact", "null follows the folder again");
  assert.equal((await readRaw(c.w, c.intake)).text, INTAKE, "a person reads the original: the layer never changes the file");
  await assert.rejects(() => c.w.call(c.w.ctxFor({ kind: "agent", id: "agt_intake", actingFor: "usr_irfad" }), "files.agent_access.set", { target: { type: "folder", id: c.claimId }, value: "on" }), /Only a person/);
  c.w.done();
});

test("files.read: Not available is refused, Needs review is refused and asks a person once, a reviewed file reads with [REDACTED]", async () => {
  const c = await claim();
  const raw = await readRaw(c.w, c.costs);
  const off = await gate(c.w, "files.read", { fileId: c.costs, as: "text" }, raw);
  assert.equal(off.refuse.code, "permission.no_grant");
  assert.equal(off.refuse.details.reason, "agent_access_off");
  assert.equal(off.output, undefined);

  const rawIntake = await readRaw(c.w, c.intake);
  const needs = await gate(c.w, "files.read", { fileId: c.intake, as: "text" }, rawIntake);
  assert.equal(needs.refuse.details.reason, "needs_review");
  assert.match(needs.refuse.message, /Do not guess/);
  const again = await gate(c.w, "files.read", { fileId: c.intake, as: "text" }, rawIntake);
  assert.equal(again.refuse.details.requestId, needs.refuse.details.requestId, "one request while one waits");
  assert.equal(c.w.events.filter((e) => e.name === "file.redact_requested").length, 1);
  const req = c.w.events.find((e) => e.name === "file.redact_requested")!.payload;
  assert.deepEqual([req.agentId, req.actingFor, req.threadId, req.name], ["agt_intake", "usr_irfad", "thr_1", "Rivera intake form.txt"]);

  for (const s of SECRETS) await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "redact", shape: "span", text: s });
  await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "highlight", shape: "span", text: "Slipped on a wet floor near aisle 7 with no warning sign." });
  const done = await c.w.call(c.ctx, "files.review", { fileId: c.intake });
  assert.equal(done.woke, 1, "Done wakes the agent that asked");
  const ready = c.w.events.find((e) => e.name === "file.redact_ready")!.payload;
  assert.deepEqual([ready.agentId, ready.actingFor, ready.threadId, ready.by], ["agt_intake", "usr_irfad", "thr_1", "usr_irfad"]);

  const ok = await gate(c.w, "files.read", { fileId: c.intake, as: "text" }, rawIntake);
  noSecret(ok.output);
  assert.match(ok.output.text, /Name: \[REDACTED\]\. Date of birth: \[REDACTED\]\. SSN: \[REDACTED\]\./);
  assert.match(ok.output.text, /==Slipped on a wet floor near aisle 7 with no warning sign\.==/, "agents see highlights as plain marks");
  assert.match(ok.output.text, /Marco Rivera, \(415\) 555-0178/, "what nobody redacted reads as it is");
  assert.ok(c.w.events.some((e) => e.name === "file.agent_read" && e.payload.fileId === c.intake && e.payload.redacted === true && e.payload.agentId === "agt_intake"), "the read is on the file's Activity");

  // a slice is cut from the redacted text, never from the original
  const part = await gate(c.w, "files.read", { fileId: c.intake, as: "text", offset: 30, length: 60 }, await readRaw(c.w, c.intake, { offset: 30, length: 60 }));
  noSecret(part.output);
  // as base64, a text file reads as its redacted bytes; a picture or a PDF with parts hidden is refused
  const b64 = await gate(c.w, "files.read", { fileId: c.intake, as: "base64" }, { base64: Buffer.from(INTAKE).toString("base64"), mime: "text/plain", size: INTAKE.length, version: 1, truncated: false });
  noSecret(Buffer.from(b64.output.base64, "base64").toString("utf8"));
  const pdf = await gate(c.w, "files.read", { fileId: c.intake, as: "base64" }, { base64: "JVBERi0=", mime: "application/pdf", size: 5, version: 1, truncated: false });
  assert.equal(pdf.refuse.details.reason, "redacted_binary");
  const url = await gate(c.w, "files.read", { fileId: c.intake, as: "url" }, { url: "/spaces/spc_t/files/x", mime: "text/plain", size: 1, version: 1, truncated: false });
  assert.equal(url.refuse.details.reason, "redacted_binary", "a download address would hand over the original");
  c.w.done();
});

test("every other content path an agent reads: viewer data, sheets, diffs, previews and pictures, comments", async () => {
  const c = await claim();
  for (const s of SECRETS) await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "redact", shape: "span", text: s });
  await c.w.call(c.ctx, "files.review", { fileId: c.intake });
  const viewer = await gate(c.w, "files.viewer_data", { fileId: c.intake }, { file: { fileId: c.intake, name: "Rivera intake form.txt" }, text: INTAKE, previewUrl: "/x", canEdit: true });
  noSecret(viewer.output);
  assert.equal(viewer.output.previewUrl, undefined, "a picture of the page cannot carry [REDACTED]");
  const diff = await gate(c.w, "files.diff", { fileId: c.intake }, { hunks: [{ lines: [{ op: "add", text: "SSN: 512-44-8391" }, { op: "ctx", text: "Name: Elena Rivera" }] }] });
  noSecret(diff.output);
  const sheet = await gate(c.w, "sheets.read_rows", { fileId: c.intake }, { rows: [{ cells: { name: "Elena Rivera", dob: "03/14/1986" } }] });
  noSecret(sheet.output);
  const ptext = await gate(c.w, "previews.text", { fileId: c.intake }, { text: INTAKE, pages: 1 });
  noSecret(ptext.output);
  for (const cap of ["previews.get", "previews.pages", "previews.thumbnails"]) assert.equal((await gate(c.w, cap, { fileId: c.intake }, { url: "/b" })).refuse.details.reason, "redacted_binary", cap);
  const comments = await gate(c.w, "files.comments.list", { fileId: c.intake }, { comments: [{ commentId: "fcm_1", text: "Her SSN is 512-44-8391", anchor: { kind: "range", quote: "Elena Rivera" } }] });
  assert.deepEqual(comments.output.comments, [], "agents see highlights, never comments");
  const openComments = await gate(c.w, "files.comments.list", { fileId: c.open }, { comments: [{ commentId: "fcm_2", text: "fine" }] });
  assert.equal(openComments.output.comments.length, 1, "an Available file with no layer keeps its comments for agents, as before");
  // the needs-review retainer and the Not available costs refuse on every content path
  for (const cap of ["files.viewer_data", "sheets.info", "files.lint", "previews.text", "files.markup.get", "mounts.sheet_read"]) {
    assert.equal((await gate(c.w, cap, { fileId: c.retainer }, { text: "Elena Rivera" })).refuse.details.reason, "needs_review", cap);
    assert.equal((await gate(c.w, cap, { fileId: c.costs }, { text: "x" })).refuse.details.reason, "agent_access_off", cap);
  }
  c.w.done();
});

test("names and paths: hidden name pieces read [REDACTED], files inside a Not available folder leave lists, a waiting file's snippet is blank", async () => {
  const c = await claim();
  await c.w.call(c.ctx, "files.marks.add", { target: { type: "folder", id: c.claimId }, kind: "redact", shape: "name", text: "Rivera" });
  await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "redact", shape: "name", text: "Rivera" });
  const list = await c.w.call(c.ctx, "files.list", { folder: c.claimId });
  const out = (await gate(c.w, "files.list", { folderId: c.claimId }, list)).output;
  const names = JSON.stringify(out);
  assert.ok(!names.includes("Rivera intake"), names.slice(0, 300));
  assert.ok(names.includes("[REDACTED] intake form.txt"));
  const bill = await c.w.call(c.ctx, "files.list", { folder: c.bill });
  const billOut = (await gate(c.w, "files.list", { folderId: c.bill }, bill)).output;
  assert.ok(!JSON.stringify(billOut).includes("case-costs"), "nothing inside a Not available folder is listed to agents");
  const hits = { hits: [{ kind: "file", id: c.retainer, title: "Rivera retainer.txt", snippet: "Retainer between Northwind and Elena Rivera", path: "Projects/Rivera injury claim/Rivera retainer.txt" }, { kind: "file", id: c.costs, title: "case-costs.csv", snippet: "MRI" }] };
  const s = (await gate(c.w, "search.query", { q: "Rivera" }, hits)).output;
  assert.equal(s.hits.length, 1, "a Not available file is not a hit");
  assert.equal(s.hits[0].snippet, "", "a file waiting for review shows no snippet");
  assert.ok(s.hits[0].path.includes("[REDACTED] injury claim"), "the hidden piece of the folder name is hidden in paths");
  const resolved = await c.w.call(c.ctx, "files.agent_view", { fileId: c.intake });
  assert.equal(resolved.name, "[REDACTED] intake form.txt");
  assert.ok(resolved.path.endsWith("[REDACTED] injury claim"));
  c.w.done();
});

test("a new version carries redactions over; one it cannot place sends the file back to Needs review until a person places or drops it", async () => {
  const c = await claim();
  for (const s of ["Elena Rivera", "03/14/1986", "(415) 555-0161"]) await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "redact", shape: "span", text: s });
  await c.w.call(c.ctx, "files.review", { fileId: c.intake });
  assert.equal((await c.w.call(c.ctx, "files.marks.list", { fileId: c.intake })).state, "reviewed");
  await c.w.write(c.intake, "Version 3. Name: Elena Rivera. Born March 14, 1986. Phone (415) 555-0161.");
  let l = await c.w.call(c.ctx, "files.marks.list", { fileId: c.intake });
  assert.equal(l.state, "needs_review");
  assert.deepEqual(l.unplaced.map((m: Obj) => m.text), ["03/14/1986"]);
  assert.ok(c.w.events.some((e) => e.name === "file.needs_review" && e.payload.unplaced === 1));
  const blocked = await gate(c.w, "files.read", { fileId: c.intake, as: "text" }, await readRaw(c.w, c.intake));
  assert.equal(blocked.refuse.details.reason, "needs_review", "agents are blocked until it is reviewed again");
  await assert.rejects(() => c.w.call(c.ctx, "files.review", { fileId: c.intake }), /Place or drop/);
  await c.w.call(c.ctx, "files.marks.place", { markId: l.unplaced[0].markId, text: "March 14, 1986" });
  l = await c.w.call(c.ctx, "files.marks.list", { fileId: c.intake });
  assert.deepEqual(l.unplaced, []);
  await c.w.call(c.ctx, "files.review", { fileId: c.intake });
  const ok = await gate(c.w, "files.read", { fileId: c.intake, as: "text" }, await readRaw(c.w, c.intake));
  assert.equal(ok.output.text, "Version 3. Name: [REDACTED]. Born [REDACTED]. Phone [REDACTED].");
  // an Available file whose new version loses a redaction is blocked too
  await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.open }, kind: "redact", shape: "span", text: "Elena Rivera" });
  assert.match((await gate(c.w, "files.read", { fileId: c.open, as: "text" }, await readRaw(c.w, c.open))).output.text, /\[REDACTED\] is a client/, "an Available file with a redaction is still served redacted");
  await c.w.write(c.open, "Nothing secret here.");
  assert.equal((await gate(c.w, "files.read", { fileId: c.open, as: "text" }, await readRaw(c.w, c.open))).refuse.details.reason, "needs_review");
  c.w.done();
});

test("an agent may add a redaction but never take one off, review a file, or carry a file out of its layer", async () => {
  const c = await claim();
  const agent = c.w.ctxFor({ kind: "agent", id: "agt_intake", actingFor: "usr_irfad" });
  const m = (await c.w.call(agent, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "redact", shape: "span", text: "512-44-8391" })).mark;
  assert.equal(m.byAgent, "agt_intake");
  assert.equal(m.by, "usr_irfad", "credited to the person it acts for: Irfad Imtiaz (Agent)");
  await assert.rejects(() => c.w.call(agent, "files.marks.remove", { markId: m.markId }), /Only a person can un-redact/);
  await assert.rejects(() => c.w.call(agent, "files.review", { fileId: c.intake }), /Only a person/);
  const hl = (await c.w.call(agent, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "highlight", shape: "span", text: "aisle 7" })).mark;
  assert.deepEqual(await c.w.call(agent, "files.marks.remove", { markId: hl.markId }), { removed: true }, "a highlight it may take off");
  for (const cap of ["files.copy", "files.move"]) assert.equal((await gate(c.w, cap, { fileId: c.intake, toFolderId: c.root }, {}, AGENT, "before")).refuse.details.reason, "redacted_file", cap);
  assert.equal((await gate(c.w, "files.folder.move", { folderId: c.claimId, toParentId: c.root }, {}, AGENT, "before")).refuse.details.reason, "redacted_folder");
  assert.deepEqual((await gate(c.w, "files.copy", { fileId: c.open, toFolderId: c.root }, { ok: 1 }, AGENT, "before")).output, { ok: 1 }, "a clear file copies as before");
  c.w.done();
});

test("disk and git: a CLI engine is not handed a folder with anything hidden below it, git diffs of such a folder are refused, connector calls to a mounted file follow its access", async () => {
  const c = await claim();
  const folders = { folders: [{ mountId: "mnt_a", folderId: c.claimId, path: "/Users/irfad/Claims" }, { mountId: "mnt_b", folderId: c.root, path: "/Users/irfad/Projects" }] };
  const kept = (await gate(c.w, "mounts.engine_folders", { person: "usr_irfad" }, folders, { principal: { kind: "service", id: "svc_host" }, origin: "engine" })).output;
  assert.deepEqual(kept.folders, [], "Projects holds the Redacted claim, so neither folder goes to the engine's disk");
  const clean = await c.w.folder(c.root, "Templates");
  await c.w.file(clean, "nda.txt", "Mutual NDA template.");
  assert.deepEqual((await gate(c.w, "mounts.engine_folders", { person: "usr_irfad" }, { folders: [{ mountId: "m", folderId: clean, path: "/T" }] }, { principal: { kind: "service", id: "svc_host" }, origin: "engine" })).output.folders.length, 1);
  assert.equal((await gate(c.w, "git.diff", { folderId: c.claimId }, { hunks: [{ lines: [{ text: "SSN 512-44-8391" }] }] })).refuse.details.reason, "redacted_folder");
  assert.equal((await gate(c.w, "git.show", { folderId: c.root, sha: "abc" }, { hunks: [] })).refuse.details.reason, "redacted_folder");
  assert.equal((await gate(c.w, "connector.content", { fileId: c.retainer }, { body: { text: "Elena Rivera" } })).refuse.details.reason, "needs_review");
  assert.equal((await gate(c.w, "connector.content", { fileId: c.costs }, { values: [["$30"]] })).refuse.details.reason, "agent_access_off");
  assert.deepEqual((await gate(c.w, "connector.content", { fileId: c.open }, { body: { text: "fine" } })).output, { body: { text: "fine" } });
  c.w.done();
});

test("Find things to redact runs pattern checks only and suggests the file's own name piece", async () => {
  const c = await claim();
  const d = await c.w.call(c.ctx, "files.redact.detect", { fileId: c.intake, names: ["Elena Rivera", "Marco Rivera"] });
  assert.equal(d.checkedBy, "patterns");
  const texts = d.suggestions.map((s: Obj) => s.text);
  for (const x of ["Elena Rivera", "Marco Rivera", "512-44-8391", "03/14/1986", "(415) 555-0161", "elena.rivera@fastmail.example", "2217 Alder Street, Apt 4", "CV-2026-04417"]) assert.ok(texts.includes(x), x);
  assert.ok(d.suggestions.some((s: Obj) => s.kind === "file_name" && s.text === "Rivera"));
  c.w.done();
});

test("Find things to redact suggests the email built from a name already redacted, so the reviewed file does not give the name away", async () => {
  const c = await claim();
  await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "redact", shape: "span", text: "Elena Rivera" });
  const d = await c.w.call(c.ctx, "files.redact.detect", { fileId: c.intake });   // no names given and no Records: the redacted name is enough
  const email = d.suggestions.find((s: Obj) => s.text === "elena.rivera@fastmail.example");
  assert.equal(email?.label, "Email with a name in it");
  assert.equal(d.suggestions.find((s: Obj) => s.text === "Marco Rivera")?.label, "Shares a name", "the spouse's name gives the family name away too");
  assert.ok(!d.suggestions.some((s: Obj) => s.text === "Elena Rivera"), "the redacted name itself is not suggested again");
  await c.w.call(c.ctx, "files.marks.add", { target: { type: "file", id: c.intake }, kind: "redact", shape: "span", text: "elena.rivera@fastmail.example" });
  assert.ok(!(await c.w.call(c.ctx, "files.redact.detect", { fileId: c.intake })).suggestions.some((s: Obj) => s.text === "elena.rivera@fastmail.example"));
  await c.w.call(c.ctx, "files.review", { fileId: c.intake });
  const view = await c.w.call(c.ctx, "files.agent_view", { fileId: c.intake });
  assert.doesNotMatch(String(view.text), /elena\.rivera|Elena Rivera/);
  assert.match(String(view.text), /Email: \[REDACTED\]/);
  c.w.done();
});

test("a folder's list reads each file's badge, each subfolder's own setting and what waits below, and the files to review next", async () => {
  const c = await claim();
  await c.w.call(c.ctx, "files.review", { fileId: c.intake });
  await gate(c.w, "files.read", { fileId: c.retainer, as: "text" }, await readRaw(c.w, c.retainer));   // Intake asks for the retainer
  const st = await c.w.call(c.ctx, "files.agent_states", { folderId: c.claimId });
  const badge = (id: string) => st.files.find((f: Obj) => f.fileId === id);
  assert.equal(badge(c.intake).state, "reviewed");
  assert.equal(badge(c.retainer).state, "needs_review");
  assert.deepEqual(badge(c.retainer).waiting, ["agt_intake"]);
  assert.deepEqual(st.folders.map((f: Obj) => [f.value, f.own, f.needs]).sort(), [["off", true, 0], ["redact", false, 1]], "Billing is set Not available here; Medical records inherits and holds one to review");
  assert.equal(st.needs, 2, "the retainer and the ER record");
  assert.deepEqual(st.queue, [c.retainer, c.er], "the folder's own files first");
  assert.equal(st.access.value, "redact");
  c.w.done();
});
