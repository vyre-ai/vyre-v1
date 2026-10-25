// Projects: make a project (record, one channel, one folder, roles as grants), from a channel, read it, the Overview, people, pins, filed chats and the read-only link (spec 3.4, 2.4).
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, NOW, DANA, LEO, MAYA, BOT, harness, codeOf, reasonOf } from "../fixtures/harness.ts";
import { key, mkProject, run } from "../fixtures/seed.ts";

async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}

// ---- create ----

test("create makes the record, exactly one channel and one folder under Projects, and an empty plan", async () => {
  const h = harness();
  const out = await run(h, "projects.create", { type: "project", title: "Probate GTM", summary: "Go to market", goal: "30 firms by June", due: NOW + 30 * DAY });
  assert.match(out.projectId, /^prj_[a-z0-9]+$/);
  const rec = h.world.records.get(out.recordId)!;
  assert.equal(rec.type, "project");
  assert.deepEqual({ title: rec.fields["title"], summary: rec.fields["summary"], status: rec.fields["status"], lead: rec.fields["lead"], goal: rec.fields["goal"] }, { title: "Probate GTM", summary: "Go to market", status: "planning", lead: DANA, goal: "30 firms by June" });
  assert.equal(rec.fields["channel"], out.channelId);
  assert.equal(rec.fields["folder"], out.folderId);
  assert.equal(h.world.channels.size, 1);
  assert.equal(h.world.folders.get(out.folderId)?.parentId, h.world.root.folderId, "Projects/<name>");
  assert.equal(h.world.folders.get(out.folderId)?.name, "Probate GTM");
  const ch = h.world.channels.get(out.channelId)!;
  assert.equal(ch.recordId, out.recordId);
  assert.equal(ch.folderId, out.folderId);
  const plan = await run(h, "projects.plan", { projectId: out.projectId });
  assert.deepEqual({ stages: plan.stages, tasks: plan.tasks, links: plan.links }, { stages: [], tasks: [], links: [] });
  assert.deepEqual(h.names(), ["project.created", "project.member_set"]);
  assert.deepEqual(h.named("project.created")[0]?.payload, { projectId: out.projectId, recordId: out.recordId, type: "project", channelId: out.channelId, folderId: out.folderId, source: "new" });
});

test("the maker leads and holds Manage on the project, its folder and its channel, written with the project as source", async () => {
  const h = harness();
  const out = await mkProject(h);
  const mine = h.world.grants.filter((g) => g.subject.id === DANA);
  assert.deepEqual(mine.map((g) => [g.resource.type, g.resource.id, g.level, g.source]).sort(), [
    ["channel", out.channelId, "manage", `project:${out.projectId}`], ["folder", out.folderId, "manage", `project:${out.projectId}`], ["project", out.projectId, "manage", `project:${out.projectId}`],
  ]);
});

test("members given at the start get their roles as grants, and the channel starts with them", async () => {
  const h = harness();
  const out = await mkProject(h, { lead: MAYA, members: [{ principal: LEO, role: "reviewer" }, { principal: BOT, role: "member" }, { principal: "grp_sales", role: "guest" }] });
  const rec = h.world.records.get(out.recordId)!;
  assert.equal(rec.fields["lead"], MAYA);
  const roles = Object.fromEntries((await run(h, "projects.members.list", { projectId: out.projectId })).members.map((m: { principal: string; role: string; kind: string }) => [m.principal, [m.role, m.kind]]));
  assert.deepEqual(roles, { [MAYA]: ["lead", "person"], [DANA]: ["member", "person"], [LEO]: ["reviewer", "person"], [BOT]: ["member", "agent"], grp_sales: ["guest", "group"] });
  const level = (who: string): string | undefined => h.world.grants.find((g) => g.subject.id === who && g.resource.type === "project")?.level;
  assert.deepEqual([level(MAYA), level(DANA), level(LEO), level(BOT), level("grp_sales")], ["manage", "edit", "view", "edit", "view"]);
  assert.equal(h.world.grants.find((g) => g.subject.id === "grp_sales")?.subject.kind, "group");
  const made = h.only("channels.create")[0]!.input;
  assert.deepEqual([...made.memberIds].sort(), [DANA, LEO, MAYA]);
  assert.deepEqual(made.agentIds, [BOT]);
});

test("the same key makes the project once", async () => {
  const h = harness();
  const k = key();
  const one = await run(h, "projects.create", { type: "project", title: "Once", idempotencyKey: k });
  const two = await run(h, "projects.create", { type: "project", title: "Once", idempotencyKey: k });
  assert.deepEqual(two, one);
  assert.equal(h.world.records.size, 1);
  assert.equal(h.world.channels.size, 1);
  assert.equal(h.named("project.created").length, 1);
});

test("two projects may share a name; each still gets its own folder and channel", async () => {
  const h = harness();
  const a = await mkProject(h, { title: "Intake" });
  const b = await mkProject(h, { title: "Intake" });
  assert.notEqual(a.folderId, b.folderId);
  assert.notEqual(a.channelId, b.channelId);
  assert.match(h.world.folders.get(b.folderId)!.name, /^Intake [a-z0-9]{4}$/);
});

test("create refuses what is not a project: no name, a type that is not a project type, dates the wrong way round, a role nobody can hold", async () => {
  const h = harness();
  await refused(run(h, "projects.create", { type: "project", title: "  " }), "validation.bad_input");
  await refused(run(h, "projects.create", { type: "contact", title: "A contact" }), "validation.bad_input");
  await refused(run(h, "projects.create", { type: "nothing", title: "No such type" }), "validation.bad_input");
  await refused(run(h, "projects.create", { type: "project", title: "Backwards", start: NOW + DAY, due: NOW }), "validation.bad_input");
  await refused(run(h, "projects.create", { type: "project", title: "Roles", members: [{ principal: "rol_admin", role: "member" }] }), "validation.bad_input");
  assert.equal(h.world.records.size, 0, "nothing was made");
  assert.equal(h.world.channels.size, 0);
});

test("a template project hands over its stages and open tasks, with dates keeping their distance from the start", async () => {
  const h = harness();
  const tpl = await mkProject(h, { title: "Matter template", start: NOW });
  await run(h, "projects.stages.set", { projectId: tpl.projectId, stages: [{ title: "Draft" }, { title: "Review" }] });
  const a = h.task(tpl, { title: "Write brief", start: NOW, due: NOW + 2 * DAY, stage: "draft" });
  const b = h.task(tpl, { title: "Client review", start: NOW + 2 * DAY, due: NOW + 4 * DAY, stage: "review" });
  h.task(tpl, { title: "Dropped idea", state: "canceled" });
  await run(h, "projects.link_tasks", { projectId: tpl.projectId, fromTaskId: a, toTaskId: b });
  const copy = await mkProject(h, { title: "Smith matter", template: tpl.projectId, start: NOW + 10 * DAY });
  const plan = await run(h, "projects.plan", { projectId: copy.projectId });
  assert.deepEqual(plan.stages.map((s: { key: string }) => s.key), ["draft", "review"]);
  assert.deepEqual(plan.tasks.map((t: { title: string; stage: string; start: number; due: number }) => [t.title, t.stage, t.start, t.due]), [
    ["Write brief", "draft", NOW + 10 * DAY, NOW + 12 * DAY], ["Client review", "review", NOW + 12 * DAY, NOW + 14 * DAY],
  ]);
  assert.equal(plan.links.length, 1);
  assert.equal(h.named("project.created").pop()?.payload["source"], "template");
  await refused(run(h, "projects.create", { type: "project", title: "Bad template", template: "prj_nothing" }), "validation.bad_input");
  await refused(run(h, "projects.create", { type: "project", title: "Bad template", template: "weekly" }), "validation.bad_input");
});

// ---- from a channel ----

test("make this a project attaches the channel it was asked on, makes the record, the folder and an empty plan", async () => {
  const h = harness();
  const ch = (h.world.handlers["channels.create"]!({ name: "Intake", visibility: "invite" }) as { channel: { channelId: string } }).channel;
  h.clear();
  const out = await run(h, "projects.from_channel", { channelId: ch.channelId });
  assert.equal(out.channelId, ch.channelId);
  assert.equal(h.only("channels.create").length, 0, "the channel that exists is the project's channel");
  assert.equal(h.world.records.get(out.recordId)?.fields["title"], "Intake");
  assert.equal(h.world.folders.get(out.folderId)?.name, "Intake");
  assert.equal(h.named("project.created")[0]?.payload["source"], "channel");
  const again = await run(h, "projects.from_channel", { channelId: ch.channelId });
  assert.deepEqual(again, out, "a channel is one project");
  assert.equal(h.world.records.size, 1);
});

test("a channel that has a folder keeps it, a title can be given, and a channel of a record is refused", async () => {
  const h = harness();
  const folder = (h.world.handlers["files.folder.create"]!({ parentId: h.world.root.folderId, name: "Channel files" }) as { folder: { folderId: string } }).folder;
  const ch = (h.world.handlers["channels.create"]!({ name: "client-x", visibility: "invite", folderId: folder.folderId }) as { channel: { channelId: string } }).channel;
  const out = await run(h, "projects.from_channel", { channelId: ch.channelId, title: "Client X" });
  assert.equal(out.folderId, folder.folderId);
  assert.equal(h.world.records.get(out.recordId)?.fields["title"], "Client X");
  const owned = (h.world.handlers["channels.create"]!({ name: "record-channel", visibility: "invite", recordId: "rec_other" }) as { channel: { channelId: string } }).channel;
  await refused(run(h, "projects.from_channel", { channelId: owned.channelId }), "validation.bad_input", "channel_has_record");
  await refused(run(h, "projects.from_channel", { channelId: "chn_nope" }), "validation.not_found");
});

// ---- get, list ----

test("get reads the record and counts the tasks, the late ones and the people", async () => {
  const h = harness();
  const p = await mkProject(h, { summary: "S", due: NOW + 9 * DAY });
  h.task(p, { title: "Late", due: NOW - DAY });
  h.task(p, { title: "Fine", due: NOW + DAY });
  h.task(p, { title: "Done", due: NOW - 2 * DAY, state: "done" });
  const out = (await run(h, "projects.get", { projectId: p.projectId })).project;
  assert.deepEqual({ ...out }, {
    projectId: p.projectId, recordId: p.recordId, type: "project", title: "Probate GTM", summary: "S", status: "planning", lead: DANA, due: NOW + 9 * DAY,
    channelId: p.channelId, folderId: p.folderId, memberCount: 1, openTasks: 2, lateTasks: 1,
  });
  await refused(run(h, "projects.get", { projectId: "prj_nope" }), "validation.not_found");
});

test("a project opens even when Tasks does not answer", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.world.down.add("tasks.list");
  const out = (await run(h, "projects.get", { projectId: p.projectId })).project;
  assert.equal(out.openTasks, 0);
  assert.ok(h.warned.length > 0);
});

test("list shows the projects you are in, filters by type, status and mine, and pages", async () => {
  const h = harness();
  const a = await mkProject(h, { title: "One" });
  h.advance(1000);
  const b = await mkProject(h, { title: "Two", lead: MAYA });
  h.advance(1000);
  await mkProject(h, { title: "Three" });
  h.world.records.get(b.recordId)!.fields["status"] = "active";
  const all = await run(h, "projects.list", {});
  assert.equal(all.total, 3);
  assert.deepEqual(all.projects.map((p: { title: string }) => p.title), ["Three", "Two", "One"], "newest first");
  assert.deepEqual((await run(h, "projects.list", { status: "active" })).projects.map((p: { title: string }) => p.title), ["Two"]);
  assert.deepEqual((await run(h, "projects.list", { type: "contact" })).projects, []);
  const first = await run(h, "projects.list", { limit: 2 });
  assert.equal(first.projects.length, 2);
  assert.equal(first.next, "2");
  assert.deepEqual((await run(h, "projects.list", { limit: 2, cursor: first.next })).projects.map((p: { projectId: string }) => p.projectId), [a.projectId]);
  assert.equal((await run(h, "projects.list", { mine: true }, h.person(LEO))).total, 0);
});

test("a person sees only the projects they are in, or may open", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.allowOnly(() => false);
  assert.equal((await run(h, "projects.list", {}, h.person(LEO))).total, 0);
  h.allowOnly(() => true);
  await run(h, "projects.members.set", { projectId: p.projectId, principal: LEO, role: "guest" });
  h.allowOnly(() => false);
  assert.equal((await run(h, "projects.list", {}, h.person(LEO))).total, 1, "Leo is in it");
});

// ---- Overview ----

test("the Overview gathers the brief, the next milestones, what is late or waiting, people and pinned files", async () => {
  const h = harness();
  const p = await mkProject(h, { goal: "Win the launch" });
  const m1 = h.task(p, { title: "Launch", start: NOW + 5 * DAY, due: NOW + 5 * DAY });
  h.task(p, { title: "Sign-off", start: NOW + 2 * DAY, due: NOW + 2 * DAY });
  h.task(p, { title: "Kickoff", start: NOW + DAY, due: NOW + DAY });
  h.task(p, { title: "Review round", start: NOW + 9 * DAY, due: NOW + 9 * DAY });
  h.task(p, { title: "Past milestone", start: NOW - DAY, due: NOW - DAY });
  const late = h.task(p, { title: "Overdue", due: NOW - 3 * DAY });
  const gate = h.task(p, { title: "At the lawyer", state: "awaiting_approval" });
  const blocked = h.task(p, { title: "After launch", due: NOW + 20 * DAY });
  await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: m1, toTaskId: blocked });
  await run(h, "projects.pin_file", { projectId: p.projectId, fileId: "fil_brief" });
  await run(h, "projects.post_update", { projectId: p.projectId, text: "On track." });
  const o = await run(h, "projects.overview", { projectId: p.projectId });
  assert.equal(o.goal, "Win the launch");
  assert.deepEqual(o.milestones.map((t: { title: string }) => t.title), ["Kickoff", "Sign-off", "Launch"], "the next three, soonest first");
  assert.equal(o.late[0].taskId, late, "the most overdue first");
  assert.ok(o.late.some((t: { title: string }) => t.title === "Past milestone"));
  assert.deepEqual(o.waiting.map((t: { taskId: string }) => t.taskId).sort(), [gate, blocked].sort(), "a task at approval, and one that waits on an open task");
  assert.equal(o.statusUpdate.text, "On track.");
  assert.equal(o.statusUpdate.drafted, false);
  assert.deepEqual(o.people.map((m: { principal: string }) => m.principal), [DANA]);
  assert.deepEqual(o.pinnedFiles, ["fil_brief"]);
  assert.deepEqual(o.recentThreads, [{ threadId: "thr_recent", title: "Kickoff", at: NOW }]);
  assert.deepEqual([o.decisions, o.linked], [[], []]);
});

test("the templates list names the project types and says where their stages come from", async () => {
  const h = harness();
  const out = await run(h, "projects.templates.list", {});
  assert.deepEqual(out.templates, [{ key: "project", title: "Project", type: "project", stages: ["planning", "active", "done"], source: "builtin" }]);
});

// ---- people ----

test("members.set gives a role as grants on the project, folder and channel; changing it replaces them; the previous role is said", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.clear();
  const set = await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" });
  assert.equal(set.member.role, "member");
  assert.equal(set.member.kind, "person");
  const ofMaya = (): string[] => h.world.grants.filter((g) => g.subject.id === MAYA).map((g) => `${g.resource.type}:${g.level}:${g.source}`).sort();
  assert.deepEqual(ofMaya(), [`channel:edit:project:${p.projectId}`, `folder:edit:project:${p.projectId}`, `project:edit:project:${p.projectId}`]);
  await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "reviewer" });
  assert.deepEqual(ofMaya(), [`channel:view:project:${p.projectId}`, `folder:view:project:${p.projectId}`, `project:view:project:${p.projectId}`], "one grant per place, at the new level");
  assert.deepEqual(h.named("project.member_set").map((e) => [e.payload["role"], e.payload["previous"]]), [["member", undefined], ["reviewer", "member"]]);
});

test("a lead is written to the record, and removing the lead clears it; removing revokes by source", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "lead" });
  assert.equal(h.world.records.get(p.recordId)?.fields["lead"], MAYA);
  h.clear();
  assert.deepEqual(await run(h, "projects.members.remove", { projectId: p.projectId, principal: MAYA }), { removed: true });
  assert.deepEqual(h.world.grants.filter((g) => g.subject.id === MAYA), []);
  assert.equal(h.world.records.get(p.recordId)?.fields["lead"], undefined);
  assert.deepEqual(h.named("project.member_removed").map((e) => e.payload), [{ projectId: p.projectId, principal: MAYA }]);
  h.clear();
  assert.deepEqual(await run(h, "projects.members.remove", { projectId: p.projectId, principal: MAYA }), { removed: false });
  assert.equal(h.emitted.length, 0);
  assert.equal(h.world.grants.filter((g) => g.subject.id === DANA).length, 3, "the others keep theirs");
});

test("an agent with a project role is a teammate there; a role or an automation cannot hold one", async () => {
  const h = harness();
  const p = await mkProject(h);
  const set = await run(h, "projects.members.set", { projectId: p.projectId, principal: BOT, role: "member" });
  assert.equal(set.member.kind, "agent");
  assert.equal(h.world.grants.find((g) => g.subject.id === BOT)?.subject.kind, "agent");
  await refused(run(h, "projects.members.set", { projectId: p.projectId, principal: "rol_admin", role: "member" }), "validation.bad_input");
  await refused(run(h, "projects.members.set", { projectId: p.projectId, principal: "aut_nightly", role: "member" }), "validation.bad_input");
});

test("only someone who manages the project can change who is on it, and the same key answers the same", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.allowOnly((a) => a.level === "view" || a.level === "edit");
  await refused(run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" }), "validation.not_found");
  await refused(run(h, "projects.members.remove", { projectId: p.projectId, principal: DANA }), "validation.not_found");
  h.allowOnly(() => true);
  const k = key();
  const one = await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member", idempotencyKey: k });
  const two = await run(h, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member", idempotencyKey: k });
  assert.deepEqual(two, one);
  assert.equal(h.named("project.member_set").filter((e) => e.payload["principal"] === MAYA).length, 1);
});

// ---- status update, pins, filed chats, read-only link ----

test("the status update is kept, written to the record, posted to the channel and marked when an agent drafted it", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.clear();
  const out = await run(h, "projects.post_update", { projectId: p.projectId, text: "  Two weeks in.  ", status: "active" });
  assert.equal(out.postedAt, NOW);
  const fields = h.world.records.get(p.recordId)!.fields;
  assert.deepEqual([fields["status_update"], fields["status_update_at"], fields["status"]], ["Two weeks in.", NOW, "active"]);
  assert.deepEqual(h.world.posts, [{ threadId: h.world.channels.get(p.channelId)!.mainThreadId, body: "Two weeks in." }]);
  assert.deepEqual(h.named("project.update_posted").map((e) => e.payload), [{ projectId: p.projectId, by: DANA, drafted: false }]);
  await run(h, "projects.post_update", { projectId: p.projectId, text: "Weekly digest." }, h.agent(BOT, DANA));
  assert.equal(h.named("project.update_posted").pop()?.payload["drafted"], true);
  await refused(run(h, "projects.post_update", { projectId: p.projectId, text: "   " }), "validation.bad_input");
});

test("an update is kept even when the channel cannot take the post", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.world.down.add("chat.post");
  const out = await run(h, "projects.post_update", { projectId: p.projectId, text: "Still counts." });
  assert.equal(out.postedAt, NOW);
  assert.equal(h.world.records.get(p.recordId)?.fields["status_update"], "Still counts.");
  assert.ok(h.warned.length > 0);
});

test("pin and unpin keep the Overview's files, once each, and mirror them to the record", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.clear();
  await run(h, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" });
  await run(h, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" });
  await run(h, "projects.pin_file", { projectId: p.projectId, fileId: "fil_b" });
  assert.equal(h.named("project.file_pinned").length, 2);
  assert.deepEqual(h.world.records.get(p.recordId)?.fields["pinned_files"], ["fil_a", "fil_b"]);
  assert.deepEqual(await run(h, "projects.unpin_file", { projectId: p.projectId, fileId: "fil_a" }), { ok: true });
  assert.deepEqual(await run(h, "projects.unpin_file", { projectId: p.projectId, fileId: "fil_a" }), { ok: false });
  assert.equal(h.named("project.file_unpinned").length, 1);
  assert.deepEqual(h.world.records.get(p.recordId)?.fields["pinned_files"], ["fil_b"]);
  await refused(run(h, "projects.pin_file", { projectId: p.projectId, fileId: "fil_missing" }), "validation.not_found");
});

test("a private chat filed under the project stays private and gets the project's folder", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.clear();
  assert.deepEqual(await run(h, "projects.file_chat", { projectId: p.projectId, threadId: "thr_mine" }), { ok: true });
  assert.equal(h.world.threadFolders.get("thr_mine"), p.folderId);
  await run(h, "projects.file_chat", { projectId: p.projectId, threadId: "thr_mine" });
  assert.equal(h.named("project.chat_filed").length, 1, "filed once");
  assert.equal(h.only("chat.post").length, 0, "nothing is posted into the project channel");
  await refused(run(h, "projects.file_chat", { projectId: p.projectId, threadId: "thr_missing" }), "validation.not_found");
});

test("share_out makes a read-only link that can expire, for someone who manages the project", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.clear();
  const out = await run(h, "projects.share_out", { projectId: p.projectId, expiresAt: NOW + 7 * DAY });
  assert.match(out.url, /^\/share\/project\/[a-z0-9]+$/);
  assert.equal(out.expiresAt, NOW + 7 * DAY);
  assert.equal(h.rows("SELECT projectId FROM projects_share")[0]?.["projectId"], p.projectId);
  assert.deepEqual(h.named("project.shared_out").map((e) => e.payload), [{ projectId: p.projectId, expiresAt: NOW + 7 * DAY }]);
  await refused(run(h, "projects.share_out", { projectId: p.projectId, expiresAt: NOW - DAY }), "validation.bad_input");
  h.allowOnly((a) => a.level !== "manage");
  await refused(run(h, "projects.share_out", { projectId: p.projectId }), "validation.not_found");
});
