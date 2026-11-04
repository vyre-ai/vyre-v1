// Projects, upkeep and links (owner, 4 Nov 2026): the manager's health override, the status update's draft and Post, the crew with a live state, a channel's project, and the links with their state
// adapters, rules and exceptions. The neighbours are the harness's in-memory world plus the few reads these calls make.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, NOW, DANA, LEO, MAYA, BOT, contractErrors, harness, codeOf } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkProject, run } from "../fixtures/seed.ts";
import { itemOf, offer, ruleTakes, recordState } from "../handlers/attach.ts";
import { crewState } from "../handlers/upkeep.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}
const asLeo = (h: Harness) => h.person(LEO);

// ---- health ----

test("a manager sets how the project stands; it is audited by event, shows who set it on every read, and null goes back to the automatic reading", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.clear();
  const out = await run(h, "projects.set", { projectId: p.projectId, health: "risk" });
  assert.deepEqual({ health: out.health, setBy: out.setBy }, { health: "risk", setBy: DANA });
  assert.deepEqual(h.named("project.health_set").map((e) => e.payload), [{ projectId: p.projectId, health: "risk", by: DANA }]);
  for (const read of [await run(h, "projects.get", { projectId: p.projectId }), (await run(h, "projects.overview", { projectId: p.projectId }))]) {
    const row = read.project;
    assert.deepEqual([row.health, row.healthSetBy, typeof row.healthSetAt], ["risk", DANA, "number"]);
    assert.deepEqual(contractErrors("projects.get", "out", { project: row }), []);
  }
  await run(h, "projects.set", { projectId: p.projectId, health: "done" });
  assert.equal(h.named("project.health_set")[1]!.payload["previous"], "risk");
  await run(h, "projects.set", { projectId: p.projectId, health: null });
  const after = (await run(h, "projects.get", { projectId: p.projectId })).project;
  assert.equal(after.health, undefined);
  assert.equal(after.healthSetBy, undefined);
});

test("only a manager sets the health, one of the five values", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.members.set", { projectId: p.projectId, principal: LEO, role: "member" });
  h.allowOnly((a) => a.level !== "manage");
  await refused(run(h, "projects.set", { projectId: p.projectId, health: "on" }), "permission.no_grant");
  h.allowOnly(() => true);
  await refused(run(h, "projects.set", { projectId: p.projectId, health: "great" }), "validation.bad_input");
  await refused(run(h, "projects.set", { projectId: "prj_none", health: "on" }), "validation.not_found");
});

// ---- the status update ----

const withAi = (h: Harness, text = "The letter is drafted. Two tasks are late.") => {
  h.world.handlers["engine.my_ai"] = () => ({ accounts: [{ ref: "#Dana_Anthropic", name: "Anthropic", provider: "anthropic", kind: "api_key", usable: true, models: [], limits: { state: "not_readable" } }, { ref: "#Dana_Claude", name: "Claude Code", provider: "anthropic", kind: "subscription", usable: true, models: [], limits: { state: "not_readable" } }] });
  h.world.handlers["engine.complete"] = () => ({ text, tokensIn: 10, tokensOut: 12 });
};

test("Draft again writes the update from the project facts on the asker's own AI account, keeps it as a draft, and posts nothing", async () => {
  const h = harness();
  withAi(h);
  const p = await mkProject(h, { goal: "Sign the letter" });
  h.task(p, { title: "Draft the letter", due: NOW - DAY });
  h.clear();
  const out = await run(h, "projects.update.draft", { projectId: p.projectId });
  assert.equal(out.text, "The letter is drafted. Two tasks are late.");
  const asked = h.only("engine.complete")[0]!.input;
  assert.equal(asked.accountRef, "#Dana_Claude", "the asker's sign-in first");
  assert.match(asked.prompt, /Project: Probate GTM/);
  assert.match(asked.prompt, /Open tasks: 1, late: 1/);
  assert.match(asked.prompt, /Draft the letter \(todo, due .*late\)/);
  assert.equal(h.only("chat.post").length, 0, "a draft is not posted");
  const o = await run(h, "projects.overview", { projectId: p.projectId });
  assert.equal(o.updateDraft.text, out.text);
  assert.equal(o.statusUpdate, undefined);
  assert.deepEqual(contractErrors("projects.overview", "out", o), []);
  assert.deepEqual(h.names(), ["project.update_drafted"]);
});

test("Draft again with no usable AI account says what to do; a provider that fails says so", async () => {
  const h = harness();
  const p = await mkProject(h);
  h.world.handlers["engine.my_ai"] = () => ({ accounts: [{ ref: "#A", name: "A", provider: "x", kind: "api_key", usable: false, models: [], limits: { state: "not_readable" } }] });
  await refused(run(h, "projects.update.draft", { projectId: p.projectId }), "validation.precondition_failed");
  withAi(h);
  h.world.handlers["engine.complete"] = () => { throw Object.assign(new Error("down"), { error: { code: "provider.unavailable", message: "down" } }); };
  await refused(run(h, "projects.update.draft", { projectId: p.projectId }), "provider.unavailable");
  h.world.handlers["engine.complete"] = () => ({ text: "  " });
  await refused(run(h, "projects.update.draft", { projectId: p.projectId }), "provider.unavailable");
});

test("Edit changes the draft in place; Post with no text posts the draft to the channel as the person and clears it", async () => {
  const h = harness();
  withAi(h);
  const p = await mkProject(h);
  await run(h, "projects.update.draft", { projectId: p.projectId });
  const edited = await run(h, "projects.update.edit", { projectId: p.projectId, text: "  On track. The letter goes out Friday.  " });
  assert.equal(edited.text, "On track. The letter goes out Friday.");
  await refused(run(h, "projects.update.edit", { projectId: p.projectId, text: " " }), "validation.bad_input");
  h.clear();
  const posted = await run(h, "projects.post_update", { projectId: p.projectId });
  assert.equal(typeof posted.postedAt, "number");
  const post = h.only("chat.post")[0]!;
  assert.equal(post.input.body, "On track. The letter goes out Friday.");
  assert.equal(h.world.posts.at(-1)?.body, "On track. The letter goes out Friday.");
  const o = await run(h, "projects.overview", { projectId: p.projectId });
  assert.deepEqual([o.statusUpdate.text, o.statusUpdate.by, o.statusUpdate.drafted, o.updateDraft], ["On track. The letter goes out Friday.", DANA, false, undefined]);
  await refused(run(h, "projects.post_update", { projectId: p.projectId }), "validation.bad_input");
  // text given wins over the draft
  await run(h, "projects.update.edit", { projectId: p.projectId, text: "Draft text" });
  await run(h, "projects.post_update", { projectId: p.projectId, text: "Typed text" });
  assert.equal(h.world.posts.at(-1)?.body, "Typed text");
  // an agent's post is marked drafted, a person's is not
  await run(h, "projects.post_update", { projectId: p.projectId, text: "From the bot" }, h.agent(BOT, DANA));
  assert.equal((await run(h, "projects.overview", { projectId: p.projectId })).statusUpdate.drafted, true);
});

// ---- the crew ----

test("crew: helpers from the project's chats with Working, Done or Needs you, the ones that need you first, a job in two chats once, and the teammates beside them", async () => {
  const h = harness();
  const p = await mkProject(h);
  const main = h.world.channels.get(p.channelId)!.mainThreadId;
  h.world.handlers["engine.crew.list"] = (i) => ({ jobs: i.threadId === main
    ? [{ jobId: "crw_1", threadId: "thr_j1", leadThreadId: main, agentId: "agt_docs", name: "Docs", title: "Draft the letter", branch: "crew/docs", base: "main", state: "working", startedAt: NOW - 3_600_000 },
       { jobId: "crw_2", threadId: "thr_j2", leadThreadId: main, agentId: "agt_billing", name: "Billing", title: "Invoice", branch: "crew/b", base: "main", state: "waiting", startedAt: NOW - 7_200_000 }]
    : [{ jobId: "crw_1", threadId: "thr_j1", leadThreadId: main, agentId: "agt_docs", name: "Docs", title: "Draft the letter", branch: "crew/docs", base: "main", state: "working", startedAt: NOW - 3_600_000 },
       { jobId: "crw_3", threadId: "thr_j3", leadThreadId: "thr_recent", agentId: "agt_intake", title: "Intake form", branch: "crew/i", base: "main", state: "merged", startedAt: NOW - DAY, endedAt: NOW - 3_600_000 }], waits: [] });
  await run(h, "projects.members.set", { projectId: p.projectId, principal: BOT, role: "member" });
  const out = await run(h, "projects.crew", { projectId: p.projectId });
  assert.deepEqual(out.helpers.map((j: { jobId: string; state: string }) => [j.jobId, j.state]), [["crw_2", "needs_you"], ["crw_1", "working"], ["crw_3", "done"]]);
  assert.deepEqual([out.working, out.needsYou], [1, 1]);
  assert.deepEqual(out.helpers[0].threadId, "thr_j2", "Open goes to the helper's own chat");
  assert.equal(out.teammates.length, 1);
  assert.deepEqual(contractErrors("projects.crew", "out", out), []);
  assert.deepEqual(["working", "waiting", "lost", "failed", "done", "merged", "paused", "stopped"].map(crewState), ["working", "needs_you", "needs_you", "needs_you", "done", "done", "stopped", "stopped"]);
  // a crew that cannot be read leaves the list empty, not the page failed
  h.world.down.add("engine.crew.list");
  assert.deepEqual((await run(h, "projects.crew", { projectId: p.projectId })).helpers, []);
});

test("for_channel finds a channel's project and says nothing for a channel without one or a project the caller cannot see", async () => {
  const h = harness();
  const p = await mkProject(h);
  assert.deepEqual(await run(h, "projects.for_channel", { channelId: p.channelId }), { projectId: p.projectId, recordId: p.recordId });
  assert.deepEqual(await run(h, "projects.for_channel", { channelId: "chn_none" }), {});
  h.allowOnly(() => false);
  assert.deepEqual(await run(h, "projects.for_channel", { channelId: p.channelId }), {});
});

// ---- links ----

const world = (h: Harness) => {
  const w = h.world.handlers;
  w["github.pull_request.get"] = (i) => ({ pullRequest: { repo: i.repo, number: i.number, title: "Add the intake form", state: i.number === 12 ? "merged" : i.number === 13 ? "closed" : "open", draft: false, url: `https://github.com/${i.repo}/pull/${i.number}` } });
  w["records.get"] = (i) => (i.recordId === "rec_inv" ? { record: { id: "rec_inv", type: "invoice", fields: { number: "INV-7", status: "sent", due: NOW - DAY } } } : i.recordId === "rec_paid" ? { record: { id: "rec_paid", type: "invoice", fields: { number: "INV-8", status: "paid", due: NOW - DAY } } } : h.world.records.has(i.recordId) ? { record: { id: i.recordId, type: "contact", fields: { name: "Ada" } } } : (() => { throw Object.assign(new Error("none"), { error: { code: "validation.not_found", message: "none" } }); })());
  w["files.get"] = (i) => ({ file: { fileId: i.fileId, name: "Letter.docx", updatedAt: NOW - 2 * DAY } });
  w["tasks.get"] = (i) => ({ task: { id: i.taskId, title: "Send the letter", state: "doing" } });
  w["threads.get"] = (i) => ({ thread: { threadId: i.threadId, title: "Kickoff" } });
  w["calendar.get_event"] = (i) => ({ event: { id: i.eventId, title: "Consult", startsAt: NOW + DAY, endsAt: NOW + DAY + 3_600_000, status: "confirmed" } });
  w["mail.thread.get"] = (i) => ({ threadId: i.threadId, subject: "Retainer terms", messages: [{}, {}, {}] });
  w["artifacts.get"] = (i) => ({ artifact: { artifactId: i.artifactId, title: "Intake summary", updatedAt: NOW } });
};

test("a link brings its state live from the source: a pull request Open, Merged or Closed, an invoice Paid or Overdue, a file's last edit, and the rest", async () => {
  const h = harness();
  world(h);
  const p = await mkProject(h);
  const link = (kind: string, ref: string, more: Record<string, unknown> = {}) => run(h, "projects.links.link", { projectId: p.projectId, kind, ref, ...more });
  await link("github.pr", "vyre-ai/website#12");
  await link("github.pr", "vyre-ai/website#13");
  await link("github.pr", "vyre-ai/website#14");
  await link("record", "invoice/rec_inv");
  await link("record", "invoice/rec_paid");
  await link("file", "fil_a");
  await link("task", "tsk_1");
  await link("chat", "thr_x");
  await link("calendar_event", "cev_1");
  await link("mail_thread", "18c2a1");
  await link("artifact", "art_1");
  await link("github.commit", "vyre-ai/website@abc1234def");
  await link("ci.run", "vyre-ai/website#run-77", { state: "Failing", label: "CI on main", url: "https://ci.example/77" });
  await link("url", "https://example.com/brief", { label: "The brief" });
  const list = await run(h, "projects.links.list", { projectId: p.projectId });
  const by = (ref: string) => list.links.find((l: { ref: string }) => l.ref === ref);
  assert.deepEqual([by("vyre-ai/website#12").state, by("vyre-ai/website#13").state, by("vyre-ai/website#14").state], ["Merged", "Closed", "Open"]);
  assert.deepEqual([by("invoice/rec_inv").state, by("invoice/rec_paid").state, by("invoice/rec_inv").label], ["Overdue", "Paid", "INV-7"]);
  assert.match(by("fil_a").state, /^Edited \d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([by("tsk_1").state, by("thr_x").label, by("cev_1").state.startsWith("On "), by("18c2a1").state], ["Doing", "Kickoff", true, "3 messages"]);
  assert.deepEqual([by("vyre-ai/website@abc1234def").label, by("vyre-ai/website#run-77").state, by("vyre-ai/website#run-77").url, by("https://example.com/brief").label], ["abc1234 in vyre-ai/website", "Failing", "https://ci.example/77", "The brief"]);
  assert.equal(list.links.every((l: { source: string; addedBy: string; addedAt: number; ruleId?: string }) => l.source === "manual" && l.addedBy === DANA && l.addedAt === NOW && l.ruleId === undefined), true);
  assert.deepEqual(contractErrors("projects.links.list", "out", list), []);
  assert.equal((await run(h, "projects.links.list", { projectId: p.projectId, kind: "github.pr" })).links.length, 3);
  assert.equal(h.named("project.item_linked").length, 14);
  // a source that is down gives the link as it was made, never an error
  h.world.down.add("github.pull_request.get");
  const down = await run(h, "projects.links.list", { projectId: p.projectId, kind: "github.pr" });
  assert.equal(down.links.length, 3);
  assert.equal(down.links[0].state, undefined);
  assert.equal(recordState({ status: "sent", due: NOW - 1 }, NOW), "Overdue");
  assert.equal(recordState({ status: "draft" }, NOW), "Draft");
});

test("linking twice is one link; a bad reference is refused; the record Overview lists linked records", async () => {
  const h = harness();
  world(h);
  const p = await mkProject(h);
  const rec = (h.world.handlers["records.create"]!({ type: "contact", fields: { name: "Ada" } }) as { record: { id: string } }).record.id;
  const a = await run(h, "projects.links.link", { projectId: p.projectId, kind: "record", ref: `contact/${rec}` });
  const b = await run(h, "projects.links.link", { projectId: p.projectId, kind: "record", ref: `contact/${rec}` });
  assert.equal(a.link.linkId, b.link.linkId);
  assert.equal(h.named("project.item_linked").length, 1);
  await refused(run(h, "projects.links.link", { projectId: p.projectId, kind: "github.pr", ref: "not a pr" }), "validation.bad_input");
  await refused(run(h, "projects.links.link", { projectId: p.projectId, kind: "url", ref: "ftp://x" }), "validation.bad_input");
  await refused(run(h, "projects.links.link", { projectId: p.projectId, kind: "nope", ref: "x" }), "validation.bad_input");
  await refused(run(h, "projects.links.link", { projectId: "prj_none", kind: "url", ref: "https://a.b" }), "validation.not_found");
  const o = await run(h, "projects.overview", { projectId: p.projectId });
  assert.deepEqual(o.linked, [{ type: "contact", recordId: rec, title: "Ada" }]);
});

test("unlink takes a link off, with an event; a manual link can be linked again; an item a rule linked becomes an exception that never comes back", async () => {
  const h = harness();
  world(h);
  const p = await mkProject(h);
  await run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "repo", repo: "vyre-ai/website" }] });
  const rule = (await run(h, "projects.links.list", { projectId: p.projectId })).rules[0];
  const made = await offer(h.ctx, { kind: "github.pr", ref: "vyre-ai/website#20", repo: "vyre-ai/website" });
  assert.equal(made.length, 1);
  assert.deepEqual([made[0]!.source, made[0]!.ruleId], ["rule", rule.ruleId]);
  h.clear();
  assert.deepEqual(await run(h, "projects.links.unlink", { projectId: p.projectId, kind: "github.pr", ref: "vyre-ai/website#20" }), { removed: true });
  assert.equal(h.named("project.item_unlinked").length, 1);
  assert.deepEqual(await run(h, "projects.links.unlink", { projectId: p.projectId, kind: "github.pr", ref: "vyre-ai/website#20" }), { removed: false });
  assert.deepEqual(await offer(h.ctx, { kind: "github.pr", ref: "vyre-ai/website#20", repo: "vyre-ai/website" }), [], "the exception holds");
  assert.equal((await offer(h.ctx, { kind: "github.pr", ref: "vyre-ai/website#21", repo: "vyre-ai/website" })).length, 1, "other items still link");
  // a person linking it by hand again lifts the exception
  await run(h, "projects.links.link", { projectId: p.projectId, kind: "github.pr", ref: "vyre-ai/website#20" });
  assert.equal((await run(h, "projects.links.list", { projectId: p.projectId, kind: "github.pr" })).links.find((l: { ref: string }) => l.ref.endsWith("#20")).source, "manual");
});

test("rules: a repository, a record filter and an email domain link matching new items with the rule's id, and nothing else", async () => {
  const h = harness();
  world(h);
  const p = await mkProject(h);
  const q = await mkProject(h, { title: "Other" });
  const set = await run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [
    { kind: "repo", repo: "vyre-ai/website" }, { kind: "record_filter", recordType: "invoice", field: "client", equals: "Rivera" }, { kind: "email_domain", domain: "@Client.com" },
  ] });
  assert.deepEqual(set.rules.map((r: { kind: string }) => r.kind), ["repo", "record_filter", "email_domain"]);
  assert.equal(set.rules[2].domain, "client.com");
  assert.deepEqual(contractErrors("projects.links.rules.set", "out", set), []);
  await run(h, "projects.links.rules.set", { projectId: q.projectId, rules: [{ kind: "repo", repo: "other/repo" }] });
  const take = async (ev: { name: string; payload: Record<string, unknown> }) => { const item = await itemOf(h.ctx, ev); return item ? offer(h.ctx, item) : []; };
  assert.equal((await take({ name: "pull_request.opened", payload: { repo: "vyre-ai/website", number: 5, author: "x" } })).length, 1);
  assert.equal((await take({ name: "repo.pushed", payload: { repo: "vyre-ai/website", branch: "main", sha: "abcdef1234" } })).length, 1);
  assert.equal((await take({ name: "pull_request.opened", payload: { repo: "elsewhere/x", number: 1, author: "x" } })).length, 0);
  assert.equal((await take({ name: "record.created", payload: { recordId: "rec_i1", type: "invoice", fields: { client: "Rivera" } } })).length, 1);
  assert.equal((await take({ name: "record.created", payload: { recordId: "rec_i2", type: "invoice", fields: { client: "Other" } } })).length, 0);
  assert.equal((await take({ name: "record.created", payload: { recordId: "rec_c1", type: "contact", fields: { client: "Rivera" } } })).length, 0);
  h.world.handlers["mail.message.get"] = () => ({ message: { threadId: "18c2a1" } });
  const mail = await take({ name: "mail.received", payload: { messageId: "eml_1", mailboxId: "mbx_1", from: "ada@mail.client.com", subject: "Hi" } });
  assert.deepEqual(mail.map((a) => [a.kind, a.ref, a.source]), [["mail_thread", "18c2a1", "rule"]]);
  assert.equal((await take({ name: "mail.received", payload: { messageId: "eml_2", mailboxId: "mbx_1", from: "ada@notclient.com", subject: "Hi" } })).length, 0);
  const links = (await run(h, "projects.links.list", { projectId: p.projectId })).links;
  assert.equal(links.length, 4);
  assert.equal(links.every((l: { ruleId?: string }) => typeof l.ruleId === "string"), true);
  assert.equal((await run(h, "projects.links.list", { projectId: q.projectId })).links.length, 0, "another project's rule did not match");
  // the same item twice is one link
  assert.equal((await take({ name: "pull_request.opened", payload: { repo: "vyre-ai/website", number: 5, author: "x" } })).length, 0);
  assert.equal(ruleTakes({ ruleId: "r", projectId: "p", kind: "repo", spec: { repo: "A/B" }, by: "u", at: 1 }, { kind: "github.pr", ref: "a/b#1", repo: "a/b" }), true, "repository names compare without case");
});

test("rules are checked and replaced as a set; a rule keeps its id when it is sent again", async () => {
  const h = harness();
  const p = await mkProject(h);
  await refused(run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "repo", repo: "nope" }] }), "validation.bad_input");
  await refused(run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "email_domain", domain: "localhost" }] }), "validation.bad_input");
  await refused(run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "record_filter", recordType: "invoice", field: "client" }] }), "validation.bad_input");
  await refused(run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "record_filter" }] }), "validation.bad_input");
  const one = await run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "repo", repo: "a/b" }] });
  const again = await run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ ruleId: one.rules[0].ruleId, kind: "repo", repo: "a/c" }, { kind: "email_domain", domain: "x.com" }] });
  assert.equal(again.rules[0].ruleId, one.rules[0].ruleId);
  assert.equal(again.rules[0].repo, "a/c");
  assert.equal(again.rules.length, 2);
  assert.equal((await run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [] })).rules.length, 0);
  assert.equal(h.named("project.link_rules_set").length, 3);
});

test("agents get the same calls when they can edit the project, as agent-sourced links; without edit they are refused", async () => {
  const h = harness();
  world(h);
  const p = await mkProject(h);
  await run(h, "projects.members.set", { projectId: p.projectId, principal: BOT, role: "member" });
  const bot = h.agent(BOT, DANA);
  const out = await run(h, "projects.links.link", { projectId: p.projectId, kind: "url", ref: "https://example.com/spec" }, bot);
  assert.deepEqual([out.link.source, out.link.addedBy], ["agent", DANA]);
  assert.equal((await run(h, "projects.links.list", { projectId: p.projectId }, bot)).links.length, 1);
  assert.deepEqual(await run(h, "projects.links.unlink", { projectId: p.projectId, kind: "url", ref: "https://example.com/spec" }, bot), { removed: true });
  await run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "repo", repo: "a/b" }] }, bot);
  h.allowOnly((a) => a.level === "view");
  await refused(run(h, "projects.links.link", { projectId: p.projectId, kind: "url", ref: "https://example.com/x" }, bot), "permission.no_grant");
  await refused(run(h, "projects.links.unlink", { projectId: p.projectId, kind: "url", ref: "https://example.com/x" }, bot), "permission.no_grant");
  await refused(run(h, "projects.links.rules.set", { projectId: p.projectId, rules: [] }, bot), "permission.no_grant");
  assert.equal((await run(h, "projects.links.list", { projectId: p.projectId }, bot)).links.length, 0, "reading needs only view");
  h.allowOnly(() => false);
  await refused(run(h, "projects.links.list", { projectId: p.projectId }, bot), "validation.not_found");
});

test("a CI run sent again with a newer state keeps the latest on the one link (l-ci-runners)", async () => {
  const h = harness();
  const p = await mkProject(h);
  const send = (state: string, label: string) => run(h, "projects.links.link", { projectId: p.projectId, kind: "ci.run", ref: "cir_abcdef123456", state, label, url: "https://github.com/northwind/site/actions/runs/9/job/3" });
  await send("Running", "build · northwind/site · running 2 min");
  h.clear();
  const done = await send("Passed", "build · northwind/site · 4 min");
  assert.deepEqual([done.link.state, done.link.label], ["Passed", "build · northwind/site · 4 min"]);
  const list = await run(h, "projects.links.list", { projectId: p.projectId, kind: "ci.run" });
  assert.equal(list.links.length, 1);
  assert.equal(list.links[0].state, "Passed");
  assert.equal(h.named("project.item_linked").length, 0, "no second link");
});
