// The contract of the projects module against its real handlers (ARCH 12.4: a module goes live only when the contract holds for the handlers, not the stubs): the handler table covers exactly the
// frozen capabilities, each example input is accepted and each answer conforms to its output schema, every error a handler raises is one the capability declares, and every event it emits is
// one it declares, with a payload that matches the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { DAY, NOW, BOT, DANA, LEO, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkChain, mkProject, run } from "../fixtures/seed.ts";

const mine = registry.capabilities.filter((c) => c.module === "projects");

test("the handler table covers exactly the 51 capabilities of the projects manifest", () => {
  assert.equal(mine.length, 51);   // 48 of l-projview (with overview_doc.restore), the one l-crews added, and archive and unarchive (l-menus)
  assert.deepEqual(Object.keys(handlers).sort(), mine.map((c) => c.name).sort());
  for (const c of mine) assert.equal(typeof handlers[c.name], "function", c.name);
});

test("each example input is a valid input", () => {
  for (const c of mine) for (const ex of c.examples) assert.deepEqual(contractErrors(c.name, "in", ex.input), [], `${c.name}: example ${ex.name}`);
});

interface Scenario { cap: string; setup?: (hn: Harness) => Promise<any> | any; run: (hn: Harness, s: any) => Promise<unknown> | unknown; expect?: string }   // eslint-disable-line @typescript-eslint/no-explicit-any

const withProject = (hn: Harness) => mkProject(hn);
const withTask = async (hn: Harness) => { const p = await mkProject(hn); const t = hn.task(p, { title: "Brief", start: NOW, due: NOW + DAY }); hn.clear(); return { ...p, t }; };
const withChain = async (hn: Harness) => mkChain(hn);
const withProposal = async (hn: Harness) => {
  const c = await mkChain(hn);
  const out = await run(hn, "projects.reschedule", { projectId: c.p.projectId, taskId: c.a, due: NOW + 5 * DAY });
  hn.clear();
  return { ...c, proposalId: out.proposalId as string };
};
const NONE = "prj_none";
const withAi = (hn: Harness): void => {
  hn.world.handlers["engine.my_ai"] = () => ({ accounts: [{ ref: "#Dana_Claude", name: "Claude Code", provider: "anthropic", kind: "subscription", usable: true, models: [], limits: { state: "not_readable" } }] });
  hn.world.handlers["engine.complete"] = () => ({ text: "On track.", tokensIn: 1, tokensOut: 1 });
};

const scenarios: Scenario[] = [
  { cap: "projects.create", run: (hn) => run(hn, "projects.create", { type: "project", title: "New", summary: "s", goal: "g", lead: MAYA, start: NOW, due: NOW + DAY, stages: [{ title: "Draft" }], members: [{ principal: LEO, role: "member" }] }) },
  { cap: "projects.create", run: (hn) => run(hn, "projects.create", { type: "project", title: "" }), expect: "validation.bad_input" },
  { cap: "projects.from_channel", setup: (hn) => (hn.world.handlers["channels.create"]!({ name: "Intake", visibility: "invite" }) as { channel: { channelId: string } }).channel, run: (hn, ch) => run(hn, "projects.from_channel", { channelId: ch.channelId }) },
  { cap: "projects.from_channel", run: (hn) => run(hn, "projects.from_channel", { channelId: "chn_none" }), expect: "validation.not_found" },
  { cap: "projects.get", setup: withProject, run: (hn, p) => run(hn, "projects.get", { projectId: p.projectId }) },
  { cap: "projects.get", run: (hn) => run(hn, "projects.get", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.list", setup: withProject, run: (hn) => run(hn, "projects.list", { mine: true, limit: 10 }) },
  { cap: "projects.roles_of", setup: withProject, run: (hn) => run(hn, "projects.roles_of", { personId: DANA }) },
  { cap: "projects.roles_of", run: (hn) => run(hn, "projects.roles_of", { personId: "agt_x" }), expect: "validation.bad_input" },
  { cap: "projects.overview", setup: withTask, run: (hn, p) => run(hn, "projects.overview", { projectId: p.projectId }) },
  { cap: "projects.overview", run: (hn) => run(hn, "projects.overview", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.templates.list", run: (hn) => run(hn, "projects.templates.list", {}) },
  { cap: "projects.members.list", setup: withProject, run: (hn, p) => run(hn, "projects.members.list", { projectId: p.projectId }) },
  { cap: "projects.members.list", run: (hn) => run(hn, "projects.members.list", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.members.set", setup: withProject, run: (hn, p) => run(hn, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" }) },
  { cap: "projects.members.set", setup: withProject, run: (hn, p) => run(hn, "projects.members.set", { projectId: p.projectId, principal: "rol_x", role: "member" }), expect: "validation.bad_input" },
  { cap: "projects.members.set", run: (hn) => run(hn, "projects.members.set", { projectId: NONE, principal: MAYA, role: "member" }), expect: "validation.not_found" },
  { cap: "projects.members.remove", setup: async (hn) => { const p = await mkProject(hn); await run(hn, "projects.members.set", { projectId: p.projectId, principal: BOT, role: "member" }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.members.remove", { projectId: p.projectId, principal: BOT }) },
  { cap: "projects.members.remove", run: (hn) => run(hn, "projects.members.remove", { projectId: NONE, principal: MAYA }), expect: "validation.not_found" },
  { cap: "projects.archive", setup: async (hn) => mkProject(hn), run: (hn, p) => run(hn, "projects.archive", { projectId: (p as { projectId: string }).projectId }) },
  { cap: "projects.archive", run: (hn) => run(hn, "projects.archive", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.unarchive", setup: async (hn) => { const p = await mkProject(hn); await run(hn, "projects.archive", { projectId: p.projectId }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.unarchive", { projectId: (p as { projectId: string }).projectId }) },
  { cap: "projects.teammates.list", setup: withProject, run: (hn, p) => run(hn, "projects.teammates.list", { projectId: p.projectId }) },
  { cap: "projects.teammates.list", run: (hn) => run(hn, "projects.teammates.list", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.teammates.create", setup: withProject, run: (hn, p) => run(hn, "projects.teammates.create", { projectId: p.projectId, name: "Security reviewer", role: "reviewer", brief: "Reviews drafts for safety." }) },
  { cap: "projects.teammates.create", run: (hn) => run(hn, "projects.teammates.create", { projectId: NONE, name: "X", role: "member" }), expect: "validation.not_found" },
  { cap: "projects.teammates.remove", setup: withProject, run: (hn, p) => run(hn, "projects.teammates.remove", { projectId: p.projectId, agentId: "agt_none" }) },
  { cap: "projects.plan", setup: withChain, run: (hn, c) => run(hn, "projects.plan", { projectId: c.p.projectId }) },
  { cap: "projects.plan", run: (hn) => run(hn, "projects.plan", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.stages.set", setup: withProject, run: (hn, p) => run(hn, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }, { title: "Review" }] }) },
  { cap: "projects.stages.set", setup: async (hn) => { const p = await mkProject(hn); await run(hn, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }] }); hn.task(p, { title: "T", stage: "draft" }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.stages.set", { projectId: p.projectId, stages: [] }), expect: "validation.precondition_failed" },
  { cap: "projects.stages.set", run: (hn) => run(hn, "projects.stages.set", { projectId: NONE, stages: [] }), expect: "validation.not_found" },
  { cap: "projects.reschedule", setup: withChain, run: (hn, c) => run(hn, "projects.reschedule", { projectId: c.p.projectId, taskId: c.a, due: NOW + 5 * DAY }) },
  { cap: "projects.reschedule", setup: withTask, run: (hn, p) => run(hn, "projects.reschedule", { projectId: p.projectId, taskId: p.t, start: NOW + 9 * DAY }), expect: "validation.bad_input" },
  { cap: "projects.reschedule", setup: withTask, run: (hn, p) => run(hn, "projects.reschedule", { projectId: p.projectId, taskId: "tsk_none", due: NOW }), expect: "validation.not_found" },
  { cap: "projects.link_tasks", setup: async (hn) => { const p = await mkProject(hn); const a = hn.task(p, { title: "A" }); const b = hn.task(p, { title: "B" }); hn.clear(); return { p, a, b }; }, run: (hn, s) => run(hn, "projects.link_tasks", { projectId: s.p.projectId, fromTaskId: s.a, toTaskId: s.b }) },
  { cap: "projects.link_tasks", setup: withChain, run: (hn, c) => run(hn, "projects.link_tasks", { projectId: c.p.projectId, fromTaskId: c.c, toTaskId: c.a }), expect: "validation.precondition_failed" },
  { cap: "projects.link_tasks", setup: withTask, run: (hn, p) => run(hn, "projects.link_tasks", { projectId: p.projectId, fromTaskId: p.t, toTaskId: "tsk_none" }), expect: "validation.not_found" },
  { cap: "projects.unlink_tasks", setup: withChain, run: (hn, c) => run(hn, "projects.unlink_tasks", { projectId: c.p.projectId, fromTaskId: c.a, toTaskId: c.b }) },
  { cap: "projects.unlink_tasks", run: (hn) => run(hn, "projects.unlink_tasks", { projectId: NONE, fromTaskId: "tsk_a", toTaskId: "tsk_b" }), expect: "validation.not_found" },
  { cap: "projects.cascade", setup: withChain, run: (hn, c) => run(hn, "projects.cascade", { projectId: c.p.projectId, taskId: c.a, due: NOW + 6 * DAY }) },
  { cap: "projects.cascade", setup: withChain, run: (hn, c) => run(hn, "projects.cascade", { projectId: c.p.projectId, taskId: c.a }), expect: "validation.bad_input" },
  { cap: "projects.cascade", setup: withChain, run: (hn, c) => run(hn, "projects.cascade", { projectId: c.p.projectId, taskId: "tsk_none", due: NOW }), expect: "validation.not_found" },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "apply" }) },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "keep" }) },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "apply" }, hn.agent(BOT, DANA)), expect: "permission.no_grant" },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: "csc_none", decision: "apply" }), expect: "validation.not_found" },
  { cap: "projects.apply_cascade", setup: async (hn) => { const s = await withProposal(hn); await run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "keep" }); return s; }, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "apply" }), expect: "validation.precondition_failed" },
  { cap: "projects.open_task_thread", setup: withTask, run: (hn, p) => run(hn, "projects.open_task_thread", { projectId: p.projectId, taskId: p.t }) },
  { cap: "projects.open_task_thread", setup: withTask, run: (hn, p) => run(hn, "projects.open_task_thread", { projectId: p.projectId, taskId: "tsk_none" }), expect: "validation.not_found" },
  { cap: "projects.post_update", setup: withProject, run: (hn, p) => run(hn, "projects.post_update", { projectId: p.projectId, text: "On track.", status: "active" }) },
  { cap: "projects.post_update", setup: withProject, run: (hn, p) => run(hn, "projects.post_update", { projectId: p.projectId, text: " " }), expect: "validation.bad_input" },
  { cap: "projects.pin_file", setup: withProject, run: (hn, p) => run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" }) },
  { cap: "projects.pin_file", setup: withProject, run: (hn, p) => run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_missing" }), expect: "validation.not_found" },
  { cap: "projects.unpin_file", setup: async (hn) => { const p = await mkProject(hn); await run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.unpin_file", { projectId: p.projectId, fileId: "fil_a" }) },
  { cap: "projects.unpin_file", run: (hn) => run(hn, "projects.unpin_file", { projectId: NONE, fileId: "fil_a" }), expect: "validation.not_found" },
  { cap: "projects.file_chat", setup: withProject, run: (hn, p) => run(hn, "projects.file_chat", { projectId: p.projectId, threadId: "thr_mine" }) },
  { cap: "projects.file_chat", setup: withProject, run: (hn, p) => run(hn, "projects.file_chat", { projectId: p.projectId, threadId: "thr_missing" }), expect: "validation.not_found" },
  { cap: "projects.files_folder", setup: (hn) => (hn.world.handlers["records.create"]!({ type: "contact", fields: { name: "Ada" } }) as { record: { id: string } }).record, run: (hn, r) => run(hn, "projects.files_folder", { type: "contact", recordId: r.id }) },
  { cap: "projects.files_folder", setup: (hn) => (hn.world.handlers["records.create"]!({ type: "contact", fields: { name: "Ada" } }) as { record: { id: string } }).record, run: (hn, r) => run(hn, "projects.files_folder", { recordId: r.id, create: false }) },
  { cap: "projects.files_folder", run: (hn) => run(hn, "projects.files_folder", { type: "contact", recordId: "rec_none" }), expect: "validation.not_found" },
  { cap: "projects.share_out", setup: withProject, run: (hn, p) => run(hn, "projects.share_out", { projectId: p.projectId, expiresAt: NOW + DAY }) },
  { cap: "projects.share_out", setup: withProject, run: (hn, p) => run(hn, "projects.share_out", { projectId: p.projectId, expiresAt: NOW - DAY }), expect: "validation.bad_input" },
  { cap: "projects.share_out", setup: withProject, run: (hn, p) => run(hn, "projects.share_out", { projectId: p.projectId, expiresInDays: 7 }) },
  { cap: "projects.unshare_out", setup: async (hn) => { const p = await withProject(hn); const l = await run(hn, "projects.share_out", { projectId: p.projectId }); hn.clear(); return { p, url: l.url as string }; }, run: (hn, s) => run(hn, "projects.unshare_out", { projectId: s.p.projectId, url: s.url }) },
  { cap: "projects.unshare_out", setup: withProject, run: (hn, p) => run(hn, "projects.unshare_out", { projectId: p.projectId, url: "/elsewhere/x" }), expect: "validation.bad_input" },
  { cap: "projects.shared_view", setup: async (hn) => { const p = await withProject(hn); const l = await run(hn, "projects.share_out", { projectId: p.projectId }); hn.clear(); return { token: (l.url as string).slice("/share/project/".length) }; }, run: (hn, s) => run(hn, "projects.shared_view", { token: s.token }, hn.as({ kind: "service", id: "svc_host" })) },
  { cap: "projects.shared_view", run: (hn) => run(hn, "projects.shared_view", { token: "0".repeat(36) }, hn.as({ kind: "service", id: "svc_host" })), expect: "validation.not_found" },
  { cap: "projects.set", setup: withProject, run: (hn, p) => run(hn, "projects.set", { projectId: p.projectId, health: "risk" }) },
  { cap: "projects.set", setup: withProject, run: (hn, p) => run(hn, "projects.set", { projectId: p.projectId, health: null }) },
  { cap: "projects.set", setup: withProject, run: (hn, p) => run(hn, "projects.set", { projectId: p.projectId, health: "great" }), expect: "validation.bad_input" },
  { cap: "projects.update.draft", setup: async (hn) => { withAi(hn); return withProject(hn); }, run: (hn, p) => run(hn, "projects.update.draft", { projectId: p.projectId }) },
  { cap: "projects.update.draft", setup: withProject, run: (hn, p) => run(hn, "projects.update.draft", { projectId: p.projectId }), expect: "validation.precondition_failed" },
  { cap: "projects.update.draft", setup: async (hn) => { withAi(hn); hn.world.handlers["engine.complete"] = () => { throw new Error("down"); }; return withProject(hn); }, run: (hn, p) => run(hn, "projects.update.draft", { projectId: p.projectId }), expect: "provider.unavailable" },
  { cap: "projects.update.edit", setup: withProject, run: (hn, p) => run(hn, "projects.update.edit", { projectId: p.projectId, text: "Going well." }) },
  { cap: "projects.update.edit", setup: withProject, run: (hn, p) => run(hn, "projects.update.edit", { projectId: p.projectId, text: " " }), expect: "validation.bad_input" },
  { cap: "projects.crew", setup: withProject, run: (hn, p) => run(hn, "projects.crew", { projectId: p.projectId }) },
  { cap: "projects.crew", run: (hn) => run(hn, "projects.crew", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.for_channel", setup: withProject, run: (hn, p) => run(hn, "projects.for_channel", { channelId: p.channelId }) },
  { cap: "projects.for_channel", run: (hn) => run(hn, "projects.for_channel", { channelId: "chn_none" }) },
  { cap: "projects.links.list", setup: withProject, run: (hn, p) => run(hn, "projects.links.list", { projectId: p.projectId }) },
  { cap: "projects.links.list", run: (hn) => run(hn, "projects.links.list", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.links.link", setup: withProject, run: (hn, p) => run(hn, "projects.links.link", { projectId: p.projectId, kind: "url", ref: "https://example.com/brief", label: "Brief" }) },
  { cap: "projects.links.link", setup: withProject, run: (hn, p) => run(hn, "projects.links.link", { projectId: p.projectId, kind: "github.pr", ref: "bad" }), expect: "validation.bad_input" },
  { cap: "projects.links.unlink", setup: async (hn) => { const p = await withProject(hn); await run(hn, "projects.links.link", { projectId: p.projectId, kind: "url", ref: "https://example.com/a" }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.links.unlink", { projectId: p.projectId, kind: "url", ref: "https://example.com/a" }) },
  { cap: "projects.links.unlink", run: (hn) => run(hn, "projects.links.unlink", { projectId: NONE, kind: "url", ref: "x" }), expect: "validation.not_found" },
  { cap: "projects.links.rules.set", setup: withProject, run: (hn, p) => run(hn, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "repo", repo: "vyre-ai/website" }, { kind: "email_domain", domain: "client.com" }] }) },
  { cap: "projects.links.rules.set", setup: withProject, run: (hn, p) => run(hn, "projects.links.rules.set", { projectId: p.projectId, rules: [{ kind: "repo", repo: "nope" }] }), expect: "validation.bad_input" },
  { cap: "projects.overview_doc.get", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.get", { projectId: p.projectId }) },
  { cap: "projects.overview_doc.get", run: (hn) => run(hn, "projects.overview_doc.get", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.overview_doc.save", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.save", { projectId: p.projectId, blocks: [{ kind: "text", text: "Hello" }], baseRev: 0 }) },
  { cap: "projects.overview_doc.save", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.save", { projectId: p.projectId, blocks: [{ kind: "text", text: "Hello" }], baseRev: 7 }), expect: "validation.precondition_failed" },
  { cap: "projects.overview_edit", setup: withProject, run: (hn, p) => run(hn, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "Hi" } }] }) },
  { cap: "projects.overview_edit", setup: withProject, run: (hn, p) => run(hn, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "delete", id: "blk_none" }] }), expect: "validation.not_found" },
  { cap: "projects.overview_get", setup: withProject, run: (hn, p) => run(hn, "projects.overview_get", { projectId: p.projectId }) },
  { cap: "projects.overview_doc.undo", setup: async (hn) => { const p = await withProject(hn); await run(hn, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "Hi" } }] }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.overview_doc.undo", { projectId: p.projectId }) },
  { cap: "projects.overview_doc.restore", setup: async (hn) => { const p = await withProject(hn); const a = await run(hn, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "One" } }] }); await run(hn, "projects.overview_edit", { projectId: p.projectId, ops: [{ op: "insert", block: { kind: "text", text: "Two" } }] }); hn.clear(); return { ...p, first: a.rev }; }, run: (hn, p) => run(hn, "projects.overview_doc.restore", { projectId: p.projectId, rev: (p as { first: number }).first }) },
  { cap: "projects.overview_doc.restore", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.restore", { projectId: p.projectId, rev: 999 }), expect: "validation.not_found" },
  { cap: "projects.overview_doc.undo", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.undo", { projectId: p.projectId }), expect: "validation.precondition_failed" },
  { cap: "projects.overview_doc.history", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.history", { projectId: p.projectId, limit: 5 }) },
  { cap: "projects.live_block.query", setup: withProject, run: (hn, p) => run(hn, "projects.live_block.query", { projectId: p.projectId, type: "status", spec: {} }) },
  { cap: "projects.live_block.query", setup: withProject, run: (hn, p) => run(hn, "projects.live_block.query", { projectId: p.projectId, type: "records", spec: {} }), expect: "validation.bad_input" },
  { cap: "projects.overview_doc.templates.list", run: (hn) => run(hn, "projects.overview_doc.templates.list", {}) },
  { cap: "projects.overview_doc.templates.save", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.templates.save", { title: "Mine", projectId: p.projectId }) },
  { cap: "projects.overview_doc.templates.save", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.templates.save", { title: "", projectId: p.projectId }), expect: "validation.bad_input" },
  { cap: "projects.overview_doc.apply_template", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.apply_template", { projectId: p.projectId, templateId: "tpl_hiring" }) },
  { cap: "projects.overview_doc.apply_template", setup: withProject, run: (hn, p) => run(hn, "projects.overview_doc.apply_template", { projectId: p.projectId, templateId: "tpl_none" }), expect: "validation.not_found" },
];

test("every path through every capability: answers match the schema, errors are declared, events are declared and match their schemas", async () => {
  let happy = 0, unhappy = 0;
  const covered = new Set<string>();
  for (const s of scenarios) {
    const cap = mine.find((c) => c.name === s.cap)!;
    const hn = harness();
    const state = s.setup ? await s.setup(hn) : undefined;
    hn.emitted.length = 0;
    let out: unknown;
    let code: string | null = null;
    try { out = await s.run(hn, state); } catch (e) { code = codeOf(e); }
    if (s.expect !== undefined) {
      unhappy++;
      assert.equal(code, s.expect, `${s.cap}: expected ${s.expect}`);
      assert.ok((cap.errors as readonly string[]).includes(s.expect), `${s.cap} does not declare ${s.expect}`);
    } else {
      happy++;
      covered.add(s.cap);
      assert.equal(code, null, `${s.cap} raised ${String(code)}`);
      assert.deepEqual(contractErrors(s.cap, "out", out), [], `${s.cap}: answer`);
    }
    for (const e of hn.emitted) assert.ok((cap.emits as readonly string[]).includes(e.name), `${s.cap} emitted undeclared ${e.name}`);
    assert.deepEqual(assertEventsConform(hn), [], s.cap);
  }
  assert.deepEqual([...covered].sort(), mine.map((c) => c.name).sort(), "every capability has a happy path");
  assert.ok(happy >= 40 && unhappy >= 42, `${happy} happy, ${unhappy} unhappy`);
});

test("the capabilities that change something raise their declared events and the reads raise none", async () => {
  const hn = harness();
  const { p, a, b } = await mkChain(hn);
  hn.clear();
  await run(hn, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }] });
  await run(hn, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" });
  await run(hn, "projects.members.remove", { projectId: p.projectId, principal: MAYA });
  await run(hn, "projects.unlink_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  await run(hn, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  await run(hn, "projects.post_update", { projectId: p.projectId, text: "x" });
  await run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" });
  await run(hn, "projects.unpin_file", { projectId: p.projectId, fileId: "fil_a" });
  await run(hn, "projects.file_chat", { projectId: p.projectId, threadId: "thr_mine" });
  await run(hn, "projects.share_out", { projectId: p.projectId });
  assert.deepEqual(hn.names(), [
    "project.stages_changed", "project.member_set", "project.member_removed", "project.tasks_unlinked", "project.tasks_linked", "project.update_posted", "project.file_pinned", "project.file_unpinned",
    "project.chat_filed", "project.shared_out",
  ]);
  assert.deepEqual(assertEventsConform(hn), []);
  const before = hn.emitted.length;
  for (const [cap, input] of [
    ["projects.get", { projectId: p.projectId }], ["projects.list", {}], ["projects.overview", { projectId: p.projectId }], ["projects.templates.list", {}],
    ["projects.members.list", { projectId: p.projectId }], ["projects.plan", { projectId: p.projectId }],
  ] as const) await run(hn, cap, input);
  assert.equal(hn.emitted.length, before, "reads emit nothing");
});
