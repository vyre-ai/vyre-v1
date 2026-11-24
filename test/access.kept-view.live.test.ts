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
