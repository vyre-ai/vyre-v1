// A read view that was published once (the rows people are served) is never reused after the access changed: a person who joins later is served their own rows, a grant given later shows, and a grant taken away
// stops showing, on the very next read. Real server-role daemon, real access and Files modules: the owner, an existing member (A) and a member who joins after the view was published (B).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { shareKept } from "../modules/access/handlers/share.ts";

let h: Hour;
before(async () => {
  h = await bootHour("keptview");
});
after(async () => {
  await h?.stop();
});

/** Whether the folder is in the person's lists: a member sees a folder shared with them under "shared", the owner sees their own under "personal". */
const seesFolder = async (
  p: { call(cap: string, input?: Record<string, unknown>): Promise<any> },
  id: string,
  section: "personal" | "shared" = "shared",
): Promise<boolean> => {
  const out = await p.call("access.lists", { type: "folder", section });
  return (out.rows as Array<{ id: string }>).some((r) => r.id === id);
};

async function member(label: string, username: string): Promise<Person> {
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const role = roles.find((r) => r.name === "Member")!;
  const inv = await h.owner.call("members.invites.create", { role: role.id, email: `${username}@firm.test` });
  const p = h.person(label, username, `${username}@firm.test`, `${username} horse battery staple 9`);
  await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  return p;
}

test("after a view is published, a later joiner, a later grant and a revoked grant are each served on the next read", async () => {
  const hits0 = shareKept.hits + shareKept.incremental;
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)?.folderId;
  assert.ok(root, "the owner has a top folder");
  const made = (await h.owner.call("files.folder.create", {
    parentId: root,
    name: "Plans",
    idempotencyKey: "kv-folder",
  })) as {
    folder: { folderId: string };
  };
  const fid = made.folder.folderId;
  assert.ok(fid, `the folder was made: ${JSON.stringify(made).slice(0, 200)}`);
  const ref = { type: "folder", id: fid };

  const a = await member("Ana Alder", "ana");
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: a.personId },
    level: "view",
    idempotencyKey: "kv-share-a",
  });
  assert.equal(await seesFolder(a, fid), true, "A sees the folder shared with them (this read publishes the view)");

  // a person who joins after the view was published
  const b = await member("Ben Birch", "ben");
  assert.equal(await seesFolder(b, fid), false, "B, new, has no access yet");
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: b.personId },
    level: "view",
    idempotencyKey: "kv-share-b",
  });
  assert.equal(await seesFolder(b, fid), true, "B sees the folder at once after the grant");
  assert.equal(await seesFolder(a, fid), true, "A still sees it");

  // a grant taken away stops showing on the next read
  await h.owner.call("access.unshare", { resource: ref, subject: { kind: "person", id: a.personId } });
  assert.equal(await seesFolder(a, fid), false, "A lost the access and no longer sees the folder");
  assert.equal(await seesFolder(b, fid), true, "B keeps it");

  // a member who leaves the Space no longer sees it either
  await h.owner.call("access.unshare", { resource: ref, subject: { kind: "person", id: b.personId } });
  assert.equal(await seesFolder(b, fid), false, "B lost it too");
  assert.ok(
    shareKept.hits + shareKept.incremental > hits0,
    "the published view was reused during the run (the shortcut is the path under test)",
  );
});

test("after a view is published, a person added to a group sees what the group was given on the next read, and loses it when removed", async () => {
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)?.folderId;
  const made = (await h.owner.call("files.folder.create", {
    parentId: root,
    name: "Team plans",
    idempotencyKey: "kv-folder-2",
  })) as {
    folder: { folderId: string };
  };
  const fid = made.folder.folderId;
  const ref = { type: "folder", id: fid };
  const c = await member("Cy Cedar", "cy");
  const group = (await h.owner.call("access.groups.create", { name: "Planners", idempotencyKey: "kv-group" })) as {
    group: { id: string };
  };
  const gid = group.group.id;
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "group", id: gid },
    level: "view",
    idempotencyKey: "kv-share-group",
  });
  assert.equal(await seesFolder(c, fid), false, "C is not in the group: this read publishes the view");
  await h.owner.call("access.groups.add_member", { groupId: gid, member: { kind: "person", id: c.personId } });
  assert.equal(await seesFolder(c, fid), true, "C joins the group and sees the folder on the next read");
  await h.owner.call("access.groups.remove_member", { groupId: gid, member: { kind: "person", id: c.personId } });
  assert.equal(await seesFolder(c, fid), false, "C leaves the group and no longer sees it");
});

test("after a view is published, a grant given to a role shows to its members on the next read and goes when the grant is removed", async () => {
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)?.folderId;
  const made = (await h.owner.call("files.folder.create", {
    parentId: root,
    name: "Everyone plans",
    idempotencyKey: "kv-folder-3",
  })) as {
    folder: { folderId: string };
  };
  const fid = made.folder.folderId;
  const ref = { type: "folder", id: fid };
  const d = await member("Di Dale", "di");
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const memberRole = roles.find((r) => r.name === "Member")!;
  assert.equal(await seesFolder(d, fid), false, "D has no access yet: this read publishes the view");
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "role", id: memberRole.id },
    level: "view",
    idempotencyKey: "kv-share-role",
  });
  assert.equal(await seesFolder(d, fid), true, "D holds the role and sees the folder on the next read");
  await h.owner.call("access.unshare", { resource: ref, subject: { kind: "role", id: memberRole.id } });
  assert.equal(await seesFolder(d, fid), false, "the role's grant is gone and so is the folder");
});

// Which path serves the next read: a change to resources or to one grant is taken in place (changedRoots, the incremental path); a change to principals, roles, role assignments, groups, policies or a label changes restOf/the
// resources and the rows are built again (the designed answer), so those tests assert the right answer whichever of the two served it and name the path in the message. Time is the one change that writes nothing to the
// log: shareOf drops a kept view when ctx.now() reaches its `until` (the earliest expiry of a grant it holds), which the expiry test exercises.
// ---- the changes a change counter could miss: each test publishes a view with a read, changes the access, and reads again at once ----

const served = async <T>(read: () => Promise<T>): Promise<{ out: T; kept: boolean; built: boolean }> => {
  const k0 = shareKept.hits + shareKept.incremental;
  const b0 = shareKept.built;
  const out = await read();
  return { out, kept: shareKept.hits + shareKept.incremental > k0, built: shareKept.built > b0 };
};
const folderIn = async (parent: string | undefined, name: string, key: string): Promise<string> => {
  const made = (await h.owner.call("files.folder.create", { parentId: parent, name, idempotencyKey: key })) as {
    folder: { folderId: string };
  };
  return made.folder.folderId;
};
const personalRoot = async (): Promise<string> => {
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  return tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)!.folderId!;
};
const forPerson = (p: Person) => ({ kind: "person", id: p.personId });

test("a label raised after a view was published takes the folder away from a member whose clearance does not reach it, at once", async () => {
  const fid = await folderIn(await personalRoot(), "Labelled", "kv-folder-label");
  const ref = { type: "folder", id: fid };
  const e = await member("Eli Elm", "eli");
  await h.owner.call("access.share", {
    resource: ref,
    subject: forPerson(e),
    level: "view",
    idempotencyKey: "kv-share-label",
  });
  assert.equal(await seesFolder(e, fid), true, "E sees the folder: this read publishes the view");
  await h.owner.call("access.labels.set", { resource: ref, label: "restricted" });
  const r = await served(() => seesFolder(e, fid));
  assert.equal(
    r.out,
    false,
    `the folder is restricted and E's clearance does not reach it (kept ${r.kept}, rebuilt ${r.built})`,
  );
  await h.owner.call("access.labels.set", { resource: ref, label: "internal" });
  assert.equal(await seesFolder(e, fid), true, "the label is lowered and E sees it again");
});

test("a suspended person is no longer served", async () => {
  const fid = await folderIn(await personalRoot(), "Suspend", "kv-folder-suspend");
  const ref = { type: "folder", id: fid };
  const f = await member("Fay Fir", "fay");
  await h.owner.call("access.share", {
    resource: ref,
    subject: forPerson(f),
    level: "view",
    idempotencyKey: "kv-share-suspend",
  });
  assert.equal(await seesFolder(f, fid), true, "F sees the folder: this read publishes the view");
  await h.owner.call("members.suspend", { personId: f.personId });
  const gone = await f.attempt("access.lists", { type: "folder", section: "shared" });
  assert.equal(gone.ok, false, "a suspended person is refused");
});

test("a role given to a person after a view was published shows what the role holds on the next read, and a role taken away takes it", async () => {
  const fid = await folderIn(await personalRoot(), "Role only", "kv-folder-role");
  const ref = { type: "folder", id: fid };
  const g = await member("Gus Gray", "gus");
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const base = roles.find((r) => r.name === "Member")!;
  const role = (await h.owner.call("access.roles.create", { name: "Plan readers", cloneFrom: base.id })).role as {
    id: string;
  };
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "role", id: role.id },
    level: "view",
    idempotencyKey: "kv-share-plan-role",
  });
  assert.equal(await seesFolder(g, fid), false, "G does not hold the role: this read publishes the view");
  await h.owner.call("access.roles.assign", { subject: forPerson(g), roleId: role.id });
  assert.equal(await seesFolder(g, fid), true, "G is given the role and sees the folder on the next read");
  await h.owner.call("access.roles.unassign", { subject: forPerson(g), roleId: role.id });
  assert.equal(await seesFolder(g, fid), false, "the role is taken away and so is the folder");
});

test("a folder moved out from under a shared folder stops being served on the next read, and is served again when moved back", async () => {
  const root = await personalRoot();
  const shared = await folderIn(root, "Open plans", "kv-folder-open");
  const closed = await folderIn(root, "Closed plans", "kv-folder-closed");
  const child = await folderIn(shared, "Inside", "kv-folder-inside");
  const i = await member("Ida Ivy", "ida");
  await h.owner.call("access.share", {
    resource: { type: "folder", id: shared },
    subject: forPerson(i),
    level: "view",
    idempotencyKey: "kv-share-open",
  });
  assert.equal(
    await seesFolder(i, child),
    true,
    "I sees the folder inside the shared one: this read publishes the view",
  );
  await h.owner.call("files.folder.move", { folderId: child, toParentId: closed });
  assert.equal(await seesFolder(i, child), false, "moved under a folder nobody shared: not served");
  await h.owner.call("files.folder.move", { folderId: child, toParentId: shared });
  assert.equal(await seesFolder(i, child), true, "moved back: served again");
});

test("a grant that expires with nothing written to the log stops being served when its time comes", async () => {
  const fid = await folderIn(await personalRoot(), "Short loan", "kv-folder-loan");
  const ref = { type: "folder", id: fid };
  const j = await member("Jo Juniper", "jo");
  await h.owner.call("access.share", {
    resource: ref,
    subject: forPerson(j),
    level: "view",
    conditions: { expiresAt: Date.now() + 4_000 },
    idempotencyKey: "kv-share-loan",
  });
  assert.equal(
    await seesFolder(j, fid),
    true,
    "J sees the folder before the grant expires: this read publishes the view",
  );
  await new Promise((r) => setTimeout(r, 5_000));
  assert.equal(await seesFolder(j, fid), false, "the grant has expired and the published view is not served");
});
