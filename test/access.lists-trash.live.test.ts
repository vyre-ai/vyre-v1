// A folder or a file that Files moved to Trash is not in access.lists: the agent's meta tool and the Console's Labels picker read that list, so neither shows a trashed item as if it were live. The access module folds
// Files' Trash events into a mark on its own resource rows (projections.ts TRASH_KEY) and the list reads the mark with the rows it already has: no call to Files, nothing to ask about an id the caller cannot see.
// Real server-role daemon, real access and Files modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let root: string;
before(async () => {
  h = await bootHour("listtrash");
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)!.folderId!;
});
after(async () => {
  await h?.stop();
});

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
const lists = async (p: Person, type: "folder" | "file") =>
  (await p.call("access.lists", { type })) as {
    rows: Array<{ id: string }>;
    total: number;
    counts: Record<string, number>;
  };
const idsOf = async (p: Person, type: "folder" | "file"): Promise<string[]> =>
  (await lists(p, type)).rows.map((r) => r.id);
const mkFolder = async (parentId: string, name: string): Promise<string> =>
  (
    (await h.owner.call("files.folder.create", { parentId, name, idempotencyKey: `lt-f-${parentId}-${name}` })) as {
      folder: { folderId: string };
    }
  ).folder.folderId;
const mkFile = async (folderId: string, name: string): Promise<string> => {
  const made = (await h.owner.call("files.create", {
    folderId,
    name,
    content: { text: "hello" },
    idempotencyKey: `lt-x-${folderId}-${name}`,
  })) as { file: { fileId?: string; id?: string } };
  return (made.file.fileId ?? made.file.id) as string;
};
const share = (type: "folder" | "file", id: string, p: Person) =>
  h.owner.call("access.share", {
    resource: { type, id },
    subject: { kind: "person", id: p.personId },
    level: "view",
    idempotencyKey: `lt-share-${id}-${p.personId}`,
  });

test("a folder put in Trash is absent from access.lists for a member and for the owner, a live one is present, a restored one is back", async () => {
  const live = await mkFolder(root, "Still here");
  const gone = await mkFolder(root, "In the bin");
  const a = await member("Ana Alder", "ana");
  for (const id of [live, gone]) await share("folder", id, a);
  const before = await idsOf(a, "folder");
  assert.ok(before.includes(live) && before.includes(gone), "both folders are listed before the Trash");
  const total = (await lists(a, "folder")).counts["shared"]!;
  await h.owner.call("files.folder.delete", { folderId: gone });
  const after = await lists(a, "folder");
  assert.ok(
    after.rows.some((r) => r.id === live),
    "the live folder is still listed",
  );
  assert.equal(
    after.rows.some((r) => r.id === gone),
    false,
    "the trashed folder is not listed",
  );
  assert.equal(after.counts["shared"], total - 1, "the section count leaves it out as well");
  assert.equal((await idsOf(h.owner, "folder")).includes(gone), false, "nor for the owner");
  await h.owner.call("files.folder.restore", { folderId: gone });
  assert.ok((await idsOf(a, "folder")).includes(gone), "restored from Trash, it is listed again");
});

test("a file put in Trash is absent from access.lists for a member who has access, and a live one is present", async () => {
  const live = await mkFile(root, "kept.txt");
  const gone = await mkFile(root, "binned.txt");
  const b = await member("Ben Birch", "ben");
  for (const id of [live, gone]) await share("file", id, b);
  assert.ok((await idsOf(b, "file")).includes(gone), "the file is listed before the Trash");
  await h.owner.call("files.delete", { fileId: gone });
  const after = await idsOf(b, "file");
  assert.ok(after.includes(live), "the live file is still listed");
  assert.equal(after.includes(gone), false, "the trashed file is not listed");
  await h.owner.call("files.restore", { fileId: gone });
  assert.ok((await idsOf(b, "file")).includes(gone), "restored, it is listed again");
});

test("a folder in Trash takes its files and folders with it; bringing it back leaves a file that was in Trash by itself in Trash", async () => {
  const top = await mkFolder(root, "Matter 7");
  const sub = await mkFolder(top, "Sub");
  const inTop = await mkFile(top, "top.txt");
  const inSub = await mkFile(sub, "deep.txt");
  const early = await mkFile(top, "early.txt");
  const c = await member("Cai Cedar", "cai");
  await share("folder", top, c); // the folder's access follows to everything in it
  assert.deepEqual(new Set((await idsOf(c, "folder")).filter((id) => id === top || id === sub)), new Set([top, sub]));
  assert.ok((await idsOf(c, "file")).includes(early));
  await h.owner.call("files.delete", { fileId: early });
  assert.equal((await idsOf(c, "file")).includes(early), false);
  await h.owner.call("files.folder.delete", { folderId: top });
  const folders = await idsOf(c, "folder");
  const files = await idsOf(c, "file");
  for (const id of [top, sub]) assert.equal(folders.includes(id), false, `folder ${id} is gone from the list`);
  for (const id of [inTop, inSub, early]) assert.equal(files.includes(id), false, `file ${id} is gone from the list`);
  await h.owner.call("files.folder.restore", { folderId: top });
  const folders2 = await idsOf(c, "folder");
  const files2 = await idsOf(c, "file");
  for (const id of [top, sub]) assert.ok(folders2.includes(id), `folder ${id} is back`);
  for (const id of [inTop, inSub]) assert.ok(files2.includes(id), `file ${id} is back`);
  assert.equal(files2.includes(early), false, "the file that was in Trash by itself stays in Trash");
});

test("a folder deleted for good stays out of the list", async () => {
  const gone = await mkFolder(root, "Shredded");
  const kid = await mkFile(gone, "k.txt");
  const d = await member("Dee Dunn", "dee");
  await share("folder", gone, d);
  await h.owner.call("files.folder.delete", { folderId: gone });
  await h.owner.call("files.folder.purge", { folderId: gone });
  assert.equal((await idsOf(d, "folder")).includes(gone), false);
  assert.equal((await idsOf(d, "file")).includes(kid), false);
});

test("a person who may not see a trashed folder learns nothing of it from the list, and no call about it is made", async () => {
  const hidden = await mkFolder(root, "Owner only");
  const e = await member("Eli Elm", "eli");
  await h.owner.call("files.folder.delete", { folderId: hidden });
  assert.equal((await idsOf(e, "folder")).includes(hidden), false);
  const probe = await e.attempt("files.live_among", { type: "folder", ids: [hidden] });
  assert.equal(probe.ok, false, "there is no capability that answers for an id the caller cannot see");
});
