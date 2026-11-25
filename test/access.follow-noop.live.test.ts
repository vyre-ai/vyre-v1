// The host's sweep at every start makes each record folder and project folder follow its record again (access.audience_set with `follows`). A folder that already follows changes nothing, so it must cost
// nothing: it used to rebuild the whole access view each time (1.7 s a call on a Space of 38,000 records, 40 times in a row after every restart; found 24 Nov timing a Meier-sized Space on box D).
// Real server-role daemon; the loop is measured in the daemon's own process.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { shareKept } from "../modules/access/handlers/share.ts";

let h: Hour;
before(async () => {
  h = await bootHour("follownoop");
});
after(async () => {
  await h?.stop();
});

test("asking a folder to follow the record it already follows rebuilds nothing", { timeout: 120_000 }, async () => {
  const FOLDERS = 12;
  for (let b = 0; b < 20; b++)
    await h.owner.call("records.bulk_upsert", {
      type: "contact",
      match: ["email"],
      createOnly: true,
      idempotencyKey: `fn-${b}`,
      rows: Array.from({ length: 500 }, (_, i) => ({ name: `Person ${b}-${i}`, email: `p${b}-${i}@fn.test` })),
    });
  const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const root = tree.roots.find((r) => r.key === "personal")!.folderId!;
  const pairs: Array<{ folder: string; record: string }> = [];
  for (let i = 0; i < FOLDERS; i++) {
    const rec = (
      (await h.owner.call("records.query", {
        type: "contact",
        filter: { field: "email", op: "eq", value: `p0-${i}@fn.test` },
        limit: 1,
      })) as { rows: Array<{ id: string }> }
    ).rows[0]!.id;
    const folder = (
      (await h.owner.call("files.folder.create", { parentId: root, name: `F${i}`, idempotencyKey: `fn-f${i}` })) as {
        folder: { folderId: string };
      }
    ).folder.folderId;
    pairs.push({ folder, record: rec });
  }
  const follow = (p: { folder: string; record: string }) =>
    h.owner.call("access.audience_set", { resource: { type: "folder", id: p.folder }, follows: p.record });

  // the first time each folder follows its record is a real change
  for (const p of pairs) await follow(p);

  // asking again changes nothing: no rebuild, and the loop is not held
  const committed = shareKept.committed;
  let last = performance.now();
  let worst = 0;
  const t = setInterval(() => {
    const n = performance.now();
    worst = Math.max(worst, n - last);
    last = n;
  }, 2);
  const t0 = performance.now();
  for (const p of pairs) await follow(p);
  const took = Math.round(performance.now() - t0);
  clearInterval(t);
  console.log(`MEASURE ${FOLDERS} repeated follows: ${took} ms, longest block ${Math.round(worst)} ms`);
  assert.equal(shareKept.committed, committed, "a folder that already follows its record rebuilt the access view");
});

test(
  "a person without Manage is refused for a folder that already follows, and a record that is not there is not found",
  { timeout: 120_000 },
  async () => {
    const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const inv = await h.owner.call("members.invites.create", {
      role: roles.find((r) => r.name === "Member")!.id,
      email: "fol@firm.test",
    });
    const p = h.person("Fol Low", "follow", "fol@firm.test", "fol horse battery staple 9");
    await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
    const tree = (await h.owner.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
    const root = tree.roots.find((r) => r.key === "personal")!.folderId!;
    const folder = (
      (await h.owner.call("files.folder.create", { parentId: root, name: "Fol", idempotencyKey: "fn-fol" })) as {
        folder: { folderId: string };
      }
    ).folder.folderId;
    const rec = (
      (await h.owner.call("records.query", {
        type: "contact",
        filter: { field: "email", op: "eq", value: "p0-0@fn.test" },
        limit: 1,
      })) as { rows: Array<{ id: string }> }
    ).rows[0]!.id;
    await h.owner.call("access.audience_set", { resource: { type: "folder", id: folder }, follows: rec }); // follows now
    const refused = await p.attempt("access.audience_set", { resource: { type: "folder", id: folder }, follows: rec });
    assert.equal(refused.ok, false, "a person with no access cannot ask, even for what is already so");
    const gone = await h.owner.attempt("access.audience_set", {
      resource: { type: "folder", id: folder },
      follows: "rec_00000000000000000000000000000000",
    });
    assert.equal(gone.ok, false);
    assert.match(JSON.stringify(gone.error ?? gone), /not_found|no such record/);
  },
);
