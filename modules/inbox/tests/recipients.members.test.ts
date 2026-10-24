// P-L5_08b: recipients_search with team members and project members, the "on its project" reason from projects.members.list, and closing the Needs you task on a match.
// The scripted stand-ins answer in the frozen output shape and every call is checked against the frozen input schema, as the invoke pipeline would.
import test from "node:test";
import assert from "node:assert/strict";
import {
  closeMatchTask, hasProjectReason, matchClosingTask, matchNewClosingTask, projectContacts, projectReach, recipientsSearchWithMembers,
} from "../handlers/recipients-members.ts";
import { linkMessage } from "../handlers/index.ts";
import { codeOf, contractErrors, DANA, harness, LEE, link, NOW } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { InboxCtx } from "../projections.ts";
import { fail } from "../../../host/src/routes/errors.ts";

interface Person { id: string; kind: "person" | "agent"; name: string; status?: "active" | "removed" | "suspended"; email?: string }
interface Project { id: string; recordId: string; members: string[]; linked: string[] }

const PEOPLE: Person[] = [
  { id: "usr_maya01", kind: "person", name: "Maya Quinn", email: "maya@vyre.test" },
  { id: "usr_omar01", kind: "person", name: "Omar Haddad", email: "omar@vyre.test" },
  { id: "usr_omari2", kind: "person", name: "Omari Lane" },
  { id: "usr_gone01", kind: "person", name: "Omar Gone", status: "removed" },
  { id: "agt_omarbot", kind: "agent", name: "Omar Bot" },
];

interface Down { principals?: boolean; projects?: boolean; mailboxes?: boolean; tasks?: "down" | "closed" | "missing" }

function setup(opts: { people?: Person[]; projects?: Project[]; down?: Down; contacts?: Parameters<typeof harness>[0] } = {}) {
  const h: Harness = harness({ contacts: [{ ...LEE }, { ...DANA }], ...(opts.contacts ?? {}) });
  const people = opts.people ?? PEOPLE;
  const projects = opts.projects ?? [];
  const down: Down = opts.down ?? {};
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const checked = (cap: string, out: unknown): unknown => {
    const misfit = contractErrors(cap, "out", out);
    if (misfit.length) throw new Error(`${cap} answered with output its contract refuses: ${misfit.join("; ")}`);
    return out;
  };
  const ctx: InboxCtx = Object.assign(Object.create(h.ctx) as InboxCtx, {
    async call(cap: string, input: unknown): Promise<unknown> {
      const body = input as Record<string, unknown>;
      const trace = h.ctx.trace.traceId;
      const misfit = ["access.principals.list", "mail.mailbox.list", "projects.list", "projects.members.list", "projects.overview", "tasks.transition"].includes(cap) ? contractErrors(cap, "in", body) : [];
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      switch (cap) {
        case "access.principals.list": {
          calls.push({ cap, input: body });
          if (down.principals) throw fail("internal.unavailable", trace);
          const q = String(body.q ?? "").toLowerCase();
          const rows = people
            .filter((p) => (!body.kind || p.kind === body.kind) && (!body.status || (p.status ?? "active") === body.status) && p.name.toLowerCase().includes(q))
            .map((p) => ({ id: p.id, kind: p.kind, name: p.name, status: p.status ?? "active", roles: [], groups: [], createdAt: NOW }));
          return checked(cap, { principals: rows });
        }
        case "mail.mailbox.list": {
          if (body.kind !== "personal") return h.ctx.call(cap, input);      // the base search lists every inbox; only the member lookup asks for personal ones
          calls.push({ cap, input: body });
          if (down.mailboxes) throw fail("internal.unavailable", trace);
          const own = people.filter((p) => p.email && p.kind === "person").map((p) => ({
            id: `mbx_${p.id.slice(4)}`, kind: "personal", address: p.email, title: p.name, ownerId: p.id, provider: "google", privacy: "private", state: "syncing",
          }));
          return checked(cap, { mailboxes: own });
        }
        case "projects.list": {
          calls.push({ cap, input: body });
          if (down.projects) throw fail("internal.unavailable", trace);
          return checked(cap, {
            projects: projects.map((p) => ({
              projectId: p.id, recordId: p.recordId, type: "project", title: p.id, status: "active", channelId: "chn_x1", folderId: "fld_x1", memberCount: p.members.length, openTasks: 0, lateTasks: 0,
            })),
          });
        }
        case "projects.members.list": {
          calls.push({ cap, input: body });
          const p = projects.find((x) => x.id === body.projectId);
          return checked(cap, { members: (p?.members ?? []).map((m) => ({ principal: m, role: "member", kind: "person", since: NOW })) });
        }
        case "projects.overview": {
          calls.push({ cap, input: body });
          const p = projects.find((x) => x.id === body.projectId);
          // only the part of the overview this module reads; the full shape is the projects module's own contract
          return { linked: (p?.linked ?? []).map((recordId) => ({ type: "contact", recordId, title: recordId })), people: [] };
        }
        case "tasks.transition": {
          calls.push({ cap, input: body });
          if (down.tasks === "down") throw fail("internal.unavailable", trace);
          if (down.tasks === "closed") throw fail("validation.precondition_failed", trace);
          if (down.tasks === "missing") throw fail("validation.not_found", trace);
          return { task: { id: body.taskId, state: body.to } };
        }
        default: return h.ctx.call(cap, input);
      }
    },
  });
  return { h, ctx, calls, count: (cap: string) => calls.filter((c) => c.cap === cap).length };
}

const labels = (r: { results: { label: string }[] }): string[] => r.results.map((x) => x.label);

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

// ---- recipients

test("recipients search returns active people from the Space beside records, with their personal mailbox address, and never agents, removed people or the caller", async () => {
  const { ctx, calls } = setup();
  const out = await recipientsSearchWithMembers(ctx, { q: "oma" });
  assert.deepEqual(contractErrors("inbox.recipients_search", "out", out), []);
  assert.deepEqual(out.results.map((r) => [r.kind, r.id]), [["member", "usr_omar01"], ["member", "usr_omari2"]]);
  assert.equal(out.results[0]!.address, "omar@vyre.test");
  assert.equal(out.results[1]!.address, undefined, "a member with no mailbox the caller can see is offered without an address");
  const asked = calls.find((c) => c.cap === "access.principals.list")!;
  assert.deepEqual([asked.input.kind, asked.input.status, asked.input.q], ["person", "active", "oma"]);
  const maya = await recipientsSearchWithMembers(ctx, { q: "maya" });
  assert.deepEqual(maya.results, [], "the caller does not offer themselves");
});

test("records and members are ranked together by score, then name", async () => {
  const { ctx } = setup({ contacts: { contacts: [{ ...LEE, name: "Omar Haddock", emails: ["haddock@acme.test"] }, { ...DANA, id: "rec_oma001", name: "Oma Reyes", emails: ["oma@reyes.test"] }] } });
  const out = await recipientsSearchWithMembers(ctx, { q: "omar" });
  assert.deepEqual(out.results.map((r) => [r.kind, r.label, r.score]), [["member", "Omar Haddad", 0.9], ["contact", "Omar Haddock", 0.9], ["member", "Omari Lane", 0.9]]);
  const oma = await recipientsSearchWithMembers(ctx, { q: "oma" });
  assert.deepEqual(oma.results.map((r) => r.label), ["Oma Reyes", "Omar Haddad", "Omar Haddock", "Omari Lane"]);
});

test("one person who is both a record and a member appears once: a tie goes to the member, a better record score wins", async () => {
  const tie = setup({ contacts: { contacts: [{ ...DANA, id: "rec_omar01", name: "Omar Haddad", emails: ["Omar@Vyre.test"] }] } });
  const a = await recipientsSearchWithMembers(tie.ctx, { q: "omar had" });
  assert.deepEqual(a.results.map((r) => [r.kind, r.id]), [["member", "usr_omar01"]], "same address, same score: the member, not the card");
  const better = setup({ contacts: { contacts: [{ ...DANA, id: "rec_omar01", name: "Omar", emails: ["omar@vyre.test"] }] } });
  const b = await recipientsSearchWithMembers(better.ctx, { q: "omar" });
  assert.deepEqual(b.results.filter((r) => r.address === "omar@vyre.test").map((r) => [r.kind, r.score]), [["contact", 1]], "an exact record outranks a prefix match on the same address");
  assert.equal(b.results.filter((r) => r.address?.toLowerCase() === "omar@vyre.test").length, 1);
});

test("a person you share a project with ranks a little higher; a project you are not a member of gives nothing", async () => {
  const mine: Project = { id: "prj_shared1", recordId: "rec_prjrec1", members: ["usr_maya01", "usr_omari2"], linked: [] };
  const s = setup({ projects: [mine] });
  const out = await recipientsSearchWithMembers(s.ctx, { q: "oma" });
  assert.deepEqual(out.results.map((r) => [r.id, r.score]), [["usr_omari2", 0.95], ["usr_omar01", 0.9]]);
  const notMine: Project = { id: "prj_other01", recordId: "rec_prjrec2", members: ["usr_omari2"], linked: [] };
  const t = setup({ projects: [notMine] });
  const out2 = await recipientsSearchWithMembers(t.ctx, { q: "oma" });
  assert.deepEqual(out2.results.map((r) => [r.id, r.score]), [["usr_omar01", 0.9], ["usr_omari2", 0.9]]);
});

test("kinds and limit are honored and a bad limit is refused like the base search", async () => {
  const s = setup();
  const only = await recipientsSearchWithMembers(s.ctx, { q: "oma", kinds: ["member"] });
  assert.ok(only.results.every((r) => r.kind === "member") && only.results.length === 2);
  const noMembers = await recipientsSearchWithMembers(s.ctx, { q: "oma", kinds: ["contact"] });
  assert.deepEqual(noMembers.results, []);
  assert.equal(s.count("access.principals.list"), 1, "members are not read when the caller did not ask for them (only the one call above)");
  const one = await recipientsSearchWithMembers(s.ctx, { q: "oma", limit: 1 });
  assert.equal(one.results.length, 1);
  await refused(recipientsSearchWithMembers(s.ctx, { q: "oma", limit: 0 }), "validation.bad_input");
  await refused(recipientsSearchWithMembers(s.ctx, { q: "oma", limit: 51 }), "validation.bad_input");
  await refused(recipientsSearchWithMembers(s.ctx, { q: "  " }), "validation.bad_input");
});

test("records, inboxes and groups still answer when the access module is down", async () => {
  const s = setup({ down: { principals: true } });
  s.h.groups.push({ id: "grp_omega1", name: "Omega team" });
  const out = await recipientsSearchWithMembers(s.ctx, { q: "ome" });
  assert.deepEqual(labels(out), ["Omega team"]);
  const noBoxes = setup({ down: { mailboxes: true } });
  const out2 = await recipientsSearchWithMembers(noBoxes.ctx, { q: "omar" });
  assert.deepEqual(out2.results.map((r) => [r.id, r.address]), [["usr_omar01", undefined], ["usr_omari2", undefined]]);
  const noProjects = setup({ down: { projects: true } });
  assert.equal((await recipientsSearchWithMembers(noProjects.ctx, { q: "omar" })).results.length, 2);
});

// ---- the project reason

test("a contact reaches you by project when its record is linked to a project you are a member of, read from projects.members.list", async () => {
  const s = setup({ projects: [
    { id: "prj_mine0001", recordId: "rec_prjrec1", members: ["usr_maya01", "usr_omar01"], linked: [LEE.id] },
    { id: "prj_theirs01", recordId: "rec_prjrec2", members: ["usr_omar01"], linked: [DANA.id] },
  ] });
  const reach = await projectReach(s.ctx);
  assert.deepEqual([...reach.linked.keys()], ["prj_mine0001"]);
  assert.deepEqual([...reach.peers], ["usr_omar01"]);
  assert.equal(await hasProjectReason(s.ctx, LEE.id), true);
  assert.equal(await hasProjectReason(s.ctx, DANA.id), false, "a project the caller is not on gives no reason");
  assert.equal(await hasProjectReason(s.ctx, null), false);
  assert.deepEqual([...(await projectContacts(s.ctx, [LEE.id, DANA.id, "rec_nobody1"]))], [LEE.id]);
  assert.ok(s.calls.some((c) => c.cap === "projects.members.list" && c.input.projectId === "prj_mine0001"));
});

test("the project record itself counts as linked, and a projects module that is down gives no reason instead of failing", async () => {
  const s = setup({ projects: [{ id: "prj_mine0001", recordId: "rec_prjrec1", members: ["usr_maya01"], linked: [] }] });
  assert.equal(await hasProjectReason(s.ctx, "rec_prjrec1"), true);
  const down = setup({ down: { projects: true } });
  assert.equal(await hasProjectReason(down.ctx, LEE.id), false);
  assert.deepEqual([...(await projectContacts(down.ctx, [LEE.id]))], []);
});

// ---- closing the Needs you task

async function unsure(s: ReturnType<typeof setup>): Promise<{ conversationId: string; taskId: string }> {
  s.h.mail.set("eml_sam1", { id: "eml_sam1", threadId: "thr_sam", subject: "Quick question", from: "sam@fox.test", to: ["maya@vyre.test"] });
  const res = await linkMessage(s.ctx, link({ address: "sam@fox.test", id: "eml_sam1", at: NOW + 1000 }));
  assert.equal(res.linked, "unsure");
  assert.ok(res.taskId, "an unsure sender raises Needs a match");
  return { conversationId: res.conversationId, taskId: res.taskId };
}

test("matching a sender closes the Needs you task that asked for the match", async () => {
  const s = setup();
  const { conversationId, taskId } = await unsure(s);
  const out = await matchClosingTask(s.ctx, { conversationId, recordId: DANA.id });
  assert.equal(out.conversation.contactId, DANA.id);
  const closing = s.calls.filter((c) => c.cap === "tasks.transition");
  assert.equal(closing.length, 1);
  assert.deepEqual([closing[0]!.input.taskId, closing[0]!.input.to], [taskId, "done"]);
});

test("creating a record for the sender closes the task too", async () => {
  const s = setup();
  const { conversationId, taskId } = await unsure(s);
  const out = await matchNewClosingTask(s.ctx, { conversationId, type: "contact", name: "Sam Fox" });
  assert.ok(out.recordId.startsWith("rec_"));
  assert.deepEqual(s.calls.filter((c) => c.cap === "tasks.transition").map((c) => c.input.taskId), [taskId]);
});

test("a task that is already closed or gone, or a task module that is down, never fails the match", async () => {
  for (const mode of ["closed", "missing", "down"] as const) {
    const s = setup({ down: { tasks: mode } });
    const { conversationId } = await unsure(s);
    const out = await matchClosingTask(s.ctx, { conversationId, recordId: DANA.id });
    assert.equal(out.conversation.contactId, DANA.id, mode);
    assert.equal(s.count("tasks.transition"), 1, mode);
  }
});

test("a conversation with no Needs you task asks the task module for nothing, and a refused match leaves the task open", async () => {
  const s = setup();
  assert.equal(await closeMatchTask(s.ctx, "cnv_nothing01"), undefined);
  assert.equal(s.count("tasks.transition"), 0);
  const { conversationId } = await unsure(s);
  await refused(matchClosingTask(s.ctx, { conversationId, recordId: "rec_nobody1" }), "validation.not_found");
  assert.equal(s.count("tasks.transition"), 0, "no record, no match, so the task stays open");
  await matchClosingTask(s.ctx, { conversationId, recordId: DANA.id });
  assert.equal(s.count("tasks.transition"), 1);
  await refused(matchClosingTask(s.ctx, { conversationId, recordId: DANA.id }), "validation.precondition_failed");
  assert.equal(s.count("tasks.transition"), 1, "a second match is refused before the task is touched again");
});
