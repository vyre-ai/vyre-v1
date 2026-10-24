// Screen test for Home sections (P-L9b_01): five sections from the core seed, Needs you top 3 order.
// Face ids match fixtures/seed/core/recipe.ts. The fixture itself is outside the layer tree, so the rows are written here.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_SEED_FACES,
  HOME_SECTION_IDS,
  HOME_SHOT_WIDTHS,
  HOME_SKINS,
  actOnNeed,
  assignFromFace,
  needsYouTop3,
  openHome,
  renderHome,
  renderHomeShot,
  undoFromDigest,
  type Face,
} from "../src/places/home/index.tsx";
import type { HomeSession } from "../src/places/home/index.tsx";

const RULE = "A project is at risk when it is overdue, blocked or slipped";

function face(id: string): Face {
  const found = CORE_SEED_FACES.find((item) => item.id === id);
  if (!found) throw new Error(`missing core face ${id}`);
  return found;
}

function task(id: string, title: string, assigned: Face, opts: { due?: number; summary?: string } = {}) {
  const row: Record<string, unknown> = {
    id,
    title,
    kind: "approve",
    state: "awaiting_approval",
    assigned: { kind: assigned.kind, id: assigned.id },
    actions: [{ key: "approve", label: "Approve" }],
  };
  if (opts.due !== undefined) row.due = opts.due;
  if (opts.summary !== undefined) row.summary = opts.summary;
  return row;
}

function digestRow(seenAt?: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: "dgs_core",
    person: "usr_olivia",
    periodStart: 1000,
    periodEnd: 2000,
    headline: ["Scout filed the Acme notes", "Helper answered Noah", "One approval is waiting"],
    items: [
      { kind: "decision", title: "Sent the proposal", line: "Helper sent it", undo: { cap: "runs.undo", input: { runId: "run_core" } } },
      { kind: "finished", title: "Acme notes", line: "Scout filed 3 notes" },
    ],
    builtBy: "agt_helper",
  };
  if (seenAt !== undefined) row.seenAt = seenAt;
  return row;
}

function seed(session: HomeSession): void {
  const olivia = face("usr_olivia");
  session.replica.put("needs_you", [
    { id: "tsk_ready", reason: "ready", task: task("tsk_ready", "Answer the client", face("usr_noah")) },
    { id: "tsk_today", reason: "due_today", task: task("tsk_today", "Review the plan", face("usr_mia"), { due: 200 }) },
    { id: "tsk_block", reason: "blocking", task: task("tsk_block", "Unblock the deploy", face("usr_adam")) },
    { id: "tsk_alert", reason: "overdue", task: task("tsk_alert", "Alert the owner", olivia, { due: 80 }) },
    { id: "tsk_approve", reason: "overdue", task: task("tsk_approve", "Approve the send", olivia, { due: 50 }) },
  ]);
  session.replica.put("my_work", [
    { id: "tsk_call", section: "open", task: task("tsk_call", "Call Acme", face("usr_noah"), { summary: "With Noah" }) },
    { id: "tsk_brief", section: "assigned_by_me", task: task("tsk_brief", "Draft the brief", face("agt_scout"), { summary: "Scout owns the draft" }) },
    { id: "tsk_notes", section: "done", task: task("tsk_notes", "File the notes", face("agt_helper")) },
  ]);
  session.replica.put("at_risk_meta", [{ id: "rule", rule: RULE }]);
  session.replica.put("at_risk", [{
    id: "rec_acme",
    project: { recordId: "rec_acme", title: "Acme", reasons: ["overdue", "blocked"], blockedTasks: 1, overdueTasks: 2 },
  }]);
  session.replica.put("digest", [{ id: "dgs_core", digest: digestRow() }]);
  session.replica.put("routines", [{
    id: "rt_morning",
    routine: { routineId: "rt_morning", agentId: "agt_scout", title: "Morning digest", at: 3000, state: "done", resultLine: "3 notes filed" },
  }]);
}

function sliceBetween(html: string, start: string, end: string): string {
  const from = html.indexOf(`data-section="${start}"`);
  const to = html.indexOf(`data-section="${end}"`);
  assert.ok(from >= 0, start);
  assert.ok(to > from, end);
  return html.slice(from, to);
}

test("five sections render from the core seed", () => {
  const session = openHome("spc_core");
  seed(session);
  const html = renderHome(session);
  const order = HOME_SECTION_IDS.map((id) => `data-section="${id}"`).join("[\\s\\S]*");
  assert.match(html, new RegExp(order));
  assert.equal(html.match(/data-source="replica"/g)?.length, 5);
  assert.match(html, /data-space="spc_core"/);
  assert.match(html, /Call Acme/);
  assert.match(html, /Assigned by you/);
  assert.match(html, /Draft the brief/);
  assert.match(html, /data-work="assigned_by_me"/);
  assert.match(html, /Morning digest/);
  assert.match(html, /3 notes filed/);
  assert.match(html, /data-face="usr_olivia"/);
  assert.match(html, /data-face="agt_scout"/);
  assert.match(html, /data-face="grp_staff"/);
  assert.match(html, /data-face-kind="role"/);
  const projects = sliceBetween(html, "projects-at-risk", "away-digest");
  assert.equal(projects.includes(RULE), true);
  assert.match(projects, /data-menu="at-risk"/);
  assert.match(projects, /data-placeholder="Menu"/);
  assert.match(projects, /Acme/);
  assert.match(projects, /overdue, blocked/);
});

test("Needs you shows the top 3 in urgency order", () => {
  const session = openHome("spc_core");
  seed(session);
  assert.deepEqual(needsYouTop3(session).map((item) => item.task.title), [
    "Approve the send",
    "Alert the owner",
    "Unblock the deploy",
  ]);
  assert.deepEqual(needsYouTop3(session).map((item) => item.reason), ["overdue", "overdue", "blocking"]);
  const needs = sliceBetween(renderHome(session), "needs-you", "my-work");
  assert.equal(needs.match(/data-rank=/g)?.length, 3);
  const rank1 = needs.indexOf('data-rank="1"');
  const rank2 = needs.indexOf('data-rank="2"');
  const rank3 = needs.indexOf('data-rank="3"');
  const approve = needs.indexOf("Approve the send");
  const alert = needs.indexOf("Alert the owner");
  const unblock = needs.indexOf("Unblock the deploy");
  assert.ok(rank1 >= 0 && rank1 < approve && approve < rank2);
  assert.ok(rank2 < alert && alert < rank3);
  assert.ok(rank3 < unblock);
  assert.match(needs, /data-rank="1" data-reason="overdue"/);
  assert.match(needs, /data-rank="2" data-reason="overdue"/);
  assert.match(needs, /data-rank="3" data-reason="blocking"/);
  assert.equal(needs.includes("Answer the client"), false);
  assert.equal(needs.includes("Review the plan"), false);
  const acted = actOnNeed(session, "tsk_approve", "approve");
  assert.equal(acted.cap, "tasks.act");
  assert.deepEqual(acted.input, { taskId: "tsk_approve", action: "approve" });
});

test("assign from a face calls tasks.assign", () => {
  const session = openHome("spc_core");
  seed(session);
  const scout = face("agt_scout");
  const call = assignFromFace(session, "tsk_call", scout);
  assert.equal(call.cap, "tasks.assign");
  assert.deepEqual(call.input, { taskId: "tsk_call", slot: "assigned", to: { kind: "agent", id: "agt_scout" } });
  const html = renderHome(session);
  assert.match(html, /data-face="agt_scout" data-face-kind="agent" data-task="tsk_call"/);
  assert.match(html, /data-menu="assign"/);
  assert.match(html, /Scout/);
});

test("the projects menu shows the counting rule from the replica", () => {
  const session = openHome("spc_core");
  seed(session);
  session.replica.put("at_risk_meta", [{ id: "rule", rule: "Counted from the replica" }]);
  const html = renderHome(session);
  const projects = sliceBetween(html, "projects-at-risk", "away-digest");
  assert.equal(projects.includes("Counted from the replica"), true);
  assert.equal(projects.includes(RULE), false);
  assert.match(projects, /data-head="true"/);
});

test("the away digest opens from the replica while offline and resets once seen", () => {
  const session = openHome("spc_core");
  seed(session);
  session.online = false;
  const offline = renderHome(session);
  const digest = sliceBetween(offline, "away-digest", "routines-today");
  assert.match(digest, /data-offline="open"/);
  assert.match(digest, /Scout filed the Acme notes/);
  assert.match(digest, /data-action="undo" data-run="run_core"/);
  assert.match(digest, /data-action="see-all"/);
  assert.match(offline, /data-online="false"/);
  const undone = undoFromDigest(session, "run_core");
  assert.equal(undone.cap, "runs.undo");
  assert.deepEqual(undone.input, { runId: "run_core" });
  session.replica.put("digest", [{ id: "dgs_core", digest: digestRow(9) }]);
  const seen = sliceBetween(renderHome(session), "away-digest", "routines-today");
  assert.match(seen, /Nothing happened while you were away/);
  assert.equal(seen.includes("Scout filed the Acme notes"), false);
});

test("sections keep a skeleton until the replica can answer", () => {
  const html = renderHome(openHome("spc_core", CORE_SEED_FACES, false));
  assert.equal(html.match(/data-skeleton=/g)?.length, 5);
  assert.match(html, /data-skeleton="needs-you" data-rows="3"/);
  assert.match(html, /min-height:144px/);
});

test("Home shots cover Northwind and Harbor Studio at 1280 and 390", () => {
  const session = openHome("spc_core");
  seed(session);
  for (const skin of HOME_SKINS) {
    for (const width of HOME_SHOT_WIDTHS) {
      const doc = renderHomeShot(session, skin, width);
      assert.equal(doc.includes(`data-skin="${skin.name}"`), true, skin.name);
      assert.equal(doc.includes(`data-kit="${skin.kit}"`), true, skin.kit);
      assert.equal(doc.includes(`data-viewport="${width}"`), true, String(width));
      assert.equal(doc.includes(`width:${width}px`), true, String(width));
      for (const id of HOME_SECTION_IDS) assert.equal(doc.includes(`data-section="${id}"`), true, id);
    }
  }
  const northwind = HOME_SKINS.find((skin) => skin.id === "northwind");
  const harbor = HOME_SKINS.find((skin) => skin.id === "harbor");
  assert.ok(northwind);
  assert.ok(harbor);
  const northDoc = renderHomeShot(session, northwind, 1280);
  const harborDoc = renderHomeShot(session, harbor, 1280);
  assert.match(northDoc, /data-accent="#5B5BD6"/);
  assert.match(harborDoc, /data-accent="#B45F3C"/);
  assert.match(northDoc, /Vyre · Northwind/);
  assert.match(harborDoc, /Vyre · Harbor Studio/);
  assert.equal(northDoc.includes("width:1280px"), true);
  assert.equal(renderHomeShot(session, northwind, 390).includes("width:390px"), true);
});
