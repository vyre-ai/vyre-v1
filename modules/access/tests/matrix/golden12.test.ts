// Golden 12 (access), as the trace of one run: the permission matrix, a folder share, moving an item out of the shared folder, revoking, Ask for access approved and then retried, and a
// view-only Ask that never goes above view. Each step does the real thing through the real handlers, asserts what a person would see, and adds a line to the trace; the test ends by
// checking the trace is exactly the six steps in order, so the lines printed in the run are the evidence and cannot drift from what ran.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../../../../kernel/src/authorize/index.ts";
import { permissions } from "../../../../generated/permissions.ts";
import { handlers } from "../../impl.ts";
import { can, world } from "../../fixtures/askworld.ts";
import { codeOf } from "../../fixtures/requestdb.ts";
import { foldersCreate, foldersPlace, foldersUnplace, lists, myAccess, share, sharesOf, unshare } from "../../handlers/share.ts";
import { putPrincipal } from "../../handlers/roles.ts";
import { NOW, rig } from "./rig.ts";

const FOLDER = { type: "folder", id: "fld_1" };

test("golden 12: matrix, folder share, move out, revoke, Ask approved then retried, view-only Ask stays at view", async () => {
  const trace: string[] = [];
  const step = (line: string): void => { trace.push(line); process.stdout.write(`# golden12 ${line}\n`); };

  // 1. the permission matrix: three roles against the catalogue through the real checker
  {
    const r = rig();
    const store = r.store;
    for (const role of ["owner", "member", "guest"] as const) {
      const id = `m_${role}`;
      putPrincipal(store, { id, kind: "person", name: id });
      store.setRoles(id, [`rol_${role}`]);
      store.grants.set(`gnt_${id}`, { id: `gnt_${id}`, subject: { kind: "person", id }, resource: { type: "record", id: "*" }, level: "manage", conditions: {}, by: "usr_admin", createdAt: NOW });
    }
    store.resources.set("rec_m", { id: "rec_m", type: "record", parentId: null, label: "public", ownerId: null, holds: 0 });
    store.bump();
    const allowed = { owner: 0, member: 0, guest: 0 };
    for (const p of permissions as unknown as { key: string; defaults: Record<string, boolean> }[]) {
      for (const role of ["owner", "member", "guest"] as const) {
        const d = authorize(store.snapshot(), { principal: `m_${role}`, action: { perm: p.key, level: "view", destructive: false }, resource: { type: "record", id: "rec_m" }, now: NOW });
        assert.equal(d.effect === "allow", p.defaults[role] === true, `${role} ${p.key}`);
        if (d.effect === "allow") allowed[role]++;
      }
    }
    assert.ok(allowed.owner > allowed.member && allowed.member > allowed.guest && allowed.guest === 0);
    step(`1 matrix: of ${permissions.length} permissions Owner holds ${allowed.owner}, Member ${allowed.member}, Guest ${allowed.guest}; each cell equals the catalogue`);
  }

  // 2 to 4. a folder share, moving out, revoking
  {
    const r = rig();
    r.item("sit_x", "usr_a");
    const a = r.as("usr_a");
    const { folder } = await foldersCreate(a, { type: "site", name: "Clients" });
    await foldersPlace(a, { resource: { type: "site", id: "sit_x" }, folderId: folder.id });
    const saw = (person: string) => myAccess(r.ctx, person).find((x) => x.id === "sit_x" && x.type === "site");
    assert.equal(saw("usr_b"), undefined, "an unshared folder shares nothing");
    const { grant } = await share(a, { resource: { type: "folder", id: folder.id }, subject: { kind: "person", id: "usr_b" }, level: "view" });
    assert.deepEqual([saw("usr_b")?.level, saw("usr_b")?.via], ["view", "folder"]);
    assert.equal(authorize(r.store.snapshot(), { principal: "usr_b", action: { perm: null, level: "view", destructive: false }, resource: { type: "site", id: "sit_x" }, now: NOW }).effect, "allow");
    assert.equal(authorize(r.store.snapshot(), { principal: "usr_b", action: { perm: null, level: "edit", destructive: false }, resource: { type: "site", id: "sit_x" }, now: NOW }).effect, "deny", "view is not edit");
    assert.equal((await lists(r.as("usr_b"), { type: "site", section: "shared" })).rows.length, 1);
    step(`2 folder share: usr_a shares the folder ${folder.id} at view; usr_b now sees sit_x through the folder (level view, via folder) and cannot edit it`);

    await foldersUnplace(a, { resource: { type: "site", id: "sit_x" } });
    assert.equal(saw("usr_b"), undefined, "moving out removes the inherited access");
    assert.equal(saw("usr_a")?.via, "owner");
    assert.equal((await lists(r.as("usr_b"), { type: "site", section: "shared" })).rows.length, 0);
    step("3 move out of the shared folder: sit_x leaves it, usr_b loses it at once, usr_a still owns it");

    await foldersPlace(a, { resource: { type: "site", id: "sit_x" }, folderId: folder.id });
    assert.equal(saw("usr_b")?.via, "folder");
    const shown = await sharesOf(a, { resource: { type: "folder", id: folder.id } });
    assert.deepEqual(shown.shares.map((s) => [s.grant.subject.id, s.through]), [["usr_a", "owner"], ["usr_b", "direct"]]);
    await unshare(a, { grantId: grant.id });
    assert.equal(saw("usr_b"), undefined, "revoking the folder grant takes the item with it");
    assert.equal(r.events.some((e) => e.name === "grant.revoked" || e.name === "access.changed"), true);
    const after = await sharesOf(a, { resource: { type: "folder", id: folder.id } });
    assert.deepEqual(after.shares.map((s) => s.grant.subject.id), ["usr_a"]);
    step(`4 revoke: the folder grant ${grant.id} is removed; usr_b has nothing on the folder or on sit_x, usr_a keeps both`);
  }

  // 5 and 6. Ask for access
  {
    const { h, store } = world();
    const ask = (who: string, level: "view" | "use" | "edit" | "manage") => handlers["access.request"](h.as(who), { resource: FOLDER, level, note: "Intake notes", idempotencyKey: `g12_${who}_${level}` } as never);
    assert.equal(can(h, store, "usr_other", "view", FOLDER), false);
    const { request } = await ask("usr_other", "edit");
    assert.equal(can(h, store, "usr_other", "view", FOLDER), false, "asking grants nothing");
    const approved = await handlers["access.requests.approve"](h.as("usr_mgr"), { requestId: request.id });
    assert.deepEqual([approved.grant.level, approved.grant.by], ["edit", "usr_mgr"]);
    assert.equal(can(h, store, "usr_other", "edit", FOLDER), true, "the retry passes");
    assert.equal(can(h, store, "usr_other", "manage", FOLDER), false, "and goes no further than approved");
    step(`5 Ask for access: usr_other asks for edit on ${FOLDER.id} (still denied), usr_mgr approves, the retry passes at edit and not at manage`);

    const before = { view: can(h, store, "usr_maya", "view", FOLDER), use: can(h, store, "usr_maya", "use", FOLDER), manage: can(h, store, "usr_maya", "manage", FOLDER) };
    assert.deepEqual(before, { view: true, use: false, manage: false });
    const mine = await ask("usr_maya", "manage");
    const refused = await handlers["access.requests.approve"](h.as("usr_maya"), { requestId: mine.request.id }).then(() => undefined, (e: unknown) => codeOf(e));
    assert.equal(refused, "validation.not_found", "she cannot approve her own request");
    assert.deepEqual({ view: can(h, store, "usr_maya", "view", FOLDER), use: can(h, store, "usr_maya", "use", FOLDER), manage: can(h, store, "usr_maya", "manage", FOLDER) }, before);
    step("6 view-only Ask: usr_maya holds view, asks for manage, cannot approve her own request, and still holds exactly view");
  }

  assert.deepEqual(trace.map((t) => t.split(" ")[0]), ["1", "2", "3", "4", "5", "6"], "the six steps ran in order");
  assert.equal(trace.length, 6);
});
