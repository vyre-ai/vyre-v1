// A folder or a file that Files moved to Trash is not in access.lists: the agent's meta tool and the Console's Labels picker read that list, so neither shows a trashed item as if it were live. Files is asked once for
// each page of rows which of them are live (files.live_among), because the Trash flag is Files' own state. Real server-role daemon, real access and Files modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("listtrash");
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
const idsOf = async (p: Person, type: "folder" | "file"): Promise<string[]> =>
  ((await p.call("access.lists", { type, section: "shared" })).rows as Array<{ id: string }>).map((r) => r.id);

test("a folder put in Trash is absent from access.lists for a member who has access, and a live one is present", async () => {
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)!.folderId!;
  const mk = async (name: string, key: string): Promise<string> =>
    (
      (await h.owner.call("files.folder.create", { parentId: root, name, idempotencyKey: key })) as {
        folder: { folderId: string };
      }
    ).folder.folderId;
  const live = await mk("Still here", "lt-live");
  const gone = await mk("In the bin", "lt-gone");
  const a = await member("Ana Alder", "ana");
  for (const id of [live, gone])
    await h.owner.call("access.share", {
      resource: { type: "folder", id },
      subject: { kind: "person", id: a.personId },
      level: "view",
      idempotencyKey: `lt-share-${id}`,
    });
  const before = await idsOf(a, "folder");
  assert.ok(before.includes(live) && before.includes(gone), "both folders are listed before the Trash");
  await h.owner.call("files.folder.delete", { folderId: gone });
  const after = await idsOf(a, "folder");
  assert.ok(after.includes(live), "the live folder is still listed");
  assert.equal(after.includes(gone), false, "the trashed folder is not listed");
  await h.owner.call("files.folder.restore", { folderId: gone });
  assert.ok((await idsOf(a, "folder")).includes(gone), "restored from Trash, it is listed again");
});

test("a file put in Trash is absent from access.lists for a member who has access, and a live one is present", async () => {
  const mkFile = async (name: string, key: string): Promise<string> => {
    const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
    const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)!.folderId!;
    const made = (await h.owner.call("files.create", {
      folderId: root,
      name,
      content: { text: "hello" },
      idempotencyKey: key,
    })) as {
      file: { fileId?: string; id?: string };
    };
    return (made.file.fileId ?? made.file.id) as string;
  };
  const live = await mkFile("kept.txt", "lt-file-live");
  const gone = await mkFile("binned.txt", "lt-file-gone");
  const b = await member("Ben Birch", "ben");
  for (const id of [live, gone])
    await h.owner.call("access.share", {
      resource: { type: "file", id },
      subject: { kind: "person", id: b.personId },
      level: "view",
      idempotencyKey: `lt-fshare-${id}`,
    });
  assert.ok((await idsOf(b, "file")).includes(gone), "the file is listed before the Trash");
  await h.owner.call("files.delete", { fileId: gone });
  const after = await idsOf(b, "file");
  assert.ok(after.includes(live), "the live file is still listed");
  assert.equal(after.includes(gone), false, "the trashed file is not listed");
});

test("files.live_among answers only the live ids and refuses a type it does not know", async () => {
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const root = tree.roots.find((r) => r.key === "personal" && r.folderId !== undefined)!.folderId!;
  const mk = async (name: string, key: string): Promise<string> =>
    (
      (await h.owner.call("files.folder.create", { parentId: root, name, idempotencyKey: key })) as {
        folder: { folderId: string };
      }
    ).folder.folderId;
  const a = await mk("Live A", "lt-la");
  const b = await mk("Live B", "lt-lb");
  await h.owner.call("files.folder.delete", { folderId: b });
  const out = (await h.owner.call("files.live_among", { type: "folder", ids: [a, b, "fld_" + "0".repeat(32)] })) as {
    live: string[];
  };
  assert.deepEqual(out.live, [a]);
  const bad = await h.owner.attempt("files.live_among", { type: "record", ids: [a] });
  assert.equal(bad.ok, false);
});
