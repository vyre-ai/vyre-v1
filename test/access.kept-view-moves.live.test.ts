// The kept share view after four changes it must not serve stale: an owner transfer of a resource, a hold placed on a folder, a group inside a group and a group that is deleted. Each test publishes a view with a read, changes
// the access, reads again at once, and asserts the answer reflects the change and which path served it (the kept view in place, or a rebuild). Real server-role daemon, real access and Files modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { shareKept } from "../modules/access/handlers/share.ts";

let h: Hour;
before(async () => {
  h = await bootHour("keptviewmoves");
});
after(async () => {
  await h?.stop();
});

type Caller = { call(cap: string, input?: Record<string, unknown>): Promise<any> };
const sees = async (p: Caller, id: string, section: "personal" | "shared" = "shared"): Promise<boolean> =>
  ((await p.call("access.lists", { type: "folder", section })).rows as Array<{ id: string }>).some((r) => r.id === id);
async function member(label: string, username: string): Promise<Person> {
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `${username}@firm.test`,
  });
  const p = h.person(label, username, `${username}@firm.test`, `${username} horse battery staple 9`);
  await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  return p;
}
const served = async <T>(read: () => Promise<T>): Promise<{ out: T; path: string }> => {
  const k0 = shareKept.hits + shareKept.incremental;
  const b0 = shareKept.built;
  const out = await read();
  const kept = shareKept.hits + shareKept.incremental > k0;
  const built = shareKept.built > b0;
  return { out, path: `kept ${kept}, rebuilt ${built}` };
};
const folderIn = async (name: string, key: string): Promise<string> => {
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)!.folderId!;
  const made = (await h.owner.call("files.folder.create", { parentId: root, name, idempotencyKey: key })) as {
    folder: { folderId: string };
  };
  return made.folder.folderId;
};
const person = (p: Person) => ({ kind: "person", id: p.personId });

test("an owner transfer: the new owner holds the folder at once, the old owner keeps Manage, and a revoked grant is not served after it", async () => {
  const fid = await folderIn("Transfer plans", "kvm-folder-transfer");
  const ref = { type: "folder", id: fid };
  const a = await member("Tara Teak", "tara");
  const b = await member("Uri Upland", "uri");
  await h.owner.call("access.share", { resource: ref, subject: person(b), level: "view", idempotencyKey: "kvm-t-b" });
  assert.equal(await sees(a, fid), false, "A holds nothing yet: this read publishes the view");
  assert.equal(await sees(b, fid), true, "B sees the folder shared with them");
  const reach = async (p: Caller): Promise<string> =>
    ((await p.call("access.reach", { items: [ref] })).items as Array<{ level: string }>)[0]!.level;
  assert.equal(await reach(h.owner), "manage", "the owner holds the folder");
  assert.equal(await reach(a), "none", "A reaches nothing before the transfer");

  await h.owner.call("access.make_owner", { resource: ref, personId: a.personId, idempotencyKey: "kvm-t-own-a" });
  const a1 = await served(async () => ({
    mine: await sees(a, fid, "personal"),
    shared: await sees(a, fid, "shared"),
    level: await reach(a),
  }));
  assert.equal(
    a1.out.level,
    "manage",
    `A holds Manage or the owner's level at once (${a1.path}): ${JSON.stringify(a1.out)}`,
  );
  assert.equal(await reach(a), "manage", "A holds Manage or the owner's level at once");
  assert.equal(await reach(h.owner), "manage", "the previous owner keeps Manage");
  assert.equal(await sees(b, fid), true, "B's grant is untouched by the transfer");
  // the new owner may grant: they are served as the owner would be
  const c = await member("Vin Vale", "vin");
  assert.equal(await sees(c, fid), false, "C holds nothing: this read publishes the view");
  const shared = await a.attempt("access.share", {
    resource: ref,
    subject: person(c),
    level: "view",
    idempotencyKey: "kvm-t-c",
  });
  assert.equal(
    shared.ok,
    true,
    `the new owner may share it: ${JSON.stringify(shared.ok ? "" : shared.error).slice(0, 200)}`,
  );
  assert.equal(await sees(c, fid), true, "C sees it on the next read");
  // the old owner's access is a grant now: taking it back goes through the owner A; the stale view must not keep serving it
  const gone = await a.attempt("access.unshare", { resource: ref, subject: { kind: "person", id: h.owner.personId } });
  if (gone.ok)
    assert.notEqual(await reach(h.owner), "manage", "the old owner's Manage was taken back and is not served");
  // and a person whose grant is revoked after the transfer is not served
  await a.call("access.unshare", { resource: ref, subject: person(b) });
  const r = await served(() => sees(b, fid));
  assert.equal(r.out, false, `B's grant was revoked by the new owner and is not served (${r.path})`);
});

test("a hold on a folder does not freeze or leak a kept view: access changes while held are served right, and the hold is not itself a grant", async () => {
  const fid = await folderIn("Held plans", "kvm-folder-hold");
  const ref = { type: "folder", id: fid };
  const d = await member("Dov Dune", "dov");
  const e = await member("Eda Ember", "eda");
  await h.owner.call("access.share", { resource: ref, subject: person(d), level: "view", idempotencyKey: "kvm-h-d" });
  assert.equal(await sees(d, fid), true, "D sees the folder: this read publishes the view");
  assert.equal(await sees(e, fid), false, "E holds nothing");
  await h.owner.call("governance.holds.place", { target: { kind: "folder", id: fid }, reason: "kept-view probe" });
  const held = await served(() => sees(d, fid));
  assert.equal(held.out, true, `D still sees the held folder (${held.path})`);
  assert.equal(await sees(e, fid), false, "the hold gave E nothing");
  // a grant given while held shows at once
  await h.owner.call("access.share", { resource: ref, subject: person(e), level: "view", idempotencyKey: "kvm-h-e" });
  const given = await served(() => sees(e, fid));
  assert.equal(given.out, true, `a grant given on a held folder shows on the next read (${given.path})`);
  // a grant taken away while held: either the hold refuses it (and the person still sees it) or it is applied (and they do not)
  const undone = await h.owner.attempt("access.unshare", { resource: ref, subject: person(d) });
  const after = await served(() => sees(d, fid));
  assert.equal(
    after.out,
    !undone.ok,
    `the unshare ${undone.ok ? "was applied, so D must not see the folder" : "was refused (" + JSON.stringify(undone.error).slice(0, 80) + "), so D still sees it"} (${after.path})`,
  );
  // released: the folder is served the same way
  await h.owner.call("governance.holds.release", { target: { kind: "folder", id: fid } });
  const rel = await served(() => sees(e, fid));
  assert.equal(rel.out, true, `E still sees the folder after the release (${rel.path})`);
  await h.owner.call("access.unshare", { resource: ref, subject: person(e) });
  assert.equal(await sees(e, fid), false, "E's grant is taken away after the release and is not served");
});

test("a group inside a group: a group cannot be added to a group, and a person in the inner group is not served what only the outer group was given", async () => {
  const fid = await folderIn("Nested plans", "kvm-folder-nested");
  const ref = { type: "folder", id: fid };
  const f = await member("Fen Fern", "fen");
  const outer = (await h.owner.call("access.groups.create", { name: "Outer", idempotencyKey: "kvm-g-outer" }))
    .group as { id: string };
  const inner = (await h.owner.call("access.groups.create", { name: "Inner", idempotencyKey: "kvm-g-inner" }))
    .group as { id: string };
  await h.owner.call("access.groups.add_member", { groupId: inner.id, member: person(f) });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "group", id: outer.id },
    level: "view",
    idempotencyKey: "kvm-g-share",
  });
  assert.equal(await sees(f, fid), false, "F is in the inner group only: this read publishes the view");
  const nest = await h.owner.attempt("access.groups.add_member", {
    groupId: outer.id,
    member: { kind: "group", id: inner.id },
  });
  const r = await served(() => sees(f, fid));
  // the manifest says groups hold no groups: if the call is refused F stays out; if it were accepted, F may be served only because of it
  assert.equal(
    r.out,
    nest.ok,
    `F is served exactly when the group in a group was accepted (accepted ${nest.ok}) (${r.path})`,
  );
  assert.equal(nest.ok, false, "a group cannot be added to a group: the call is refused");
  // the direct way in still works and goes with the removal
  await h.owner.call("access.groups.add_member", { groupId: outer.id, member: person(f) });
  assert.equal(await sees(f, fid), true, "F added to the outer group sees the folder");
  await h.owner.call("access.groups.remove_member", { groupId: outer.id, member: person(f) });
  assert.equal(await sees(f, fid), false, "F removed from the outer group loses it, whatever the inner group holds");
});

test("a deleted group: the folder its members saw through it is not served on the next read, and a new group of the same name gives nothing back", async () => {
  const fid = await folderIn("Deleted group plans", "kvm-folder-delgroup");
  const ref = { type: "folder", id: fid };
  const g = await member("Gil Grove", "gil");
  const k = await member("Kit Knoll", "kit");
  const grp = (await h.owner.call("access.groups.create", { name: "Doomed", idempotencyKey: "kvm-g-doomed" }))
    .group as { id: string };
  await h.owner.call("access.groups.add_member", { groupId: grp.id, member: person(g) });
  await h.owner.call("access.groups.add_member", { groupId: grp.id, member: person(k) });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "group", id: grp.id },
    level: "view",
    idempotencyKey: "kvm-g-doomed-share",
  });
  assert.equal(await sees(g, fid), true, "G sees the folder through the group: this read publishes the view");
  assert.equal(await sees(k, fid), true, "K sees it too");
  await h.owner.call("access.groups.delete", { groupId: grp.id });
  const rg = await served(() => sees(g, fid));
  assert.equal(rg.out, false, `the group is deleted and G no longer sees the folder (${rg.path})`);
  assert.equal(await sees(k, fid), false, "nor K");
  const again = (await h.owner.call("access.groups.create", { name: "Doomed", idempotencyKey: "kvm-g-doomed-2" }))
    .group as { id: string };
  await h.owner.call("access.groups.add_member", { groupId: again.id, member: person(g) });
  const back = await served(() => sees(g, fid));
  assert.equal(back.out, false, `a new group of the same name carries no grant (${back.path})`);
  const left = JSON.stringify(await h.owner.call("access.groups.list", {}));
  assert.equal(left.includes(grp.id), false, "the deleted group is not in the list");
});
