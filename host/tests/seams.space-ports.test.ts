// The Space ports behind the Google and Microsoft seams: members by the email their invitation went to, Space files by id, and bytes in through an upload slot of the Files module.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createBlobs, createFiles, createMembers } from "../src/seams/space-ports.ts";

function invites(rows: { email: string | null; by: string | null; state?: string; at?: number }[]) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE members_invites (id TEXT, email TEXT, state TEXT, accepted_by TEXT, accepted_at INTEGER)");
  rows.forEach((r, i) => db.prepare("INSERT INTO members_invites VALUES (?, ?, ?, ?, ?)").run(`inv_${i}`, r.email, r.state ?? "accepted", r.by, r.at ?? i));
  return { all: (sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as unknown[] };
}

test("members are listed by the email their invitation went to; open invitations, people who left and repeated addresses are left out", async () => {
  const db = invites([
    { email: "Noah@Firm.test", by: "usr_noah" }, { email: "gone@firm.test", by: "usr_gone" }, { email: "open@firm.test", by: null, state: "open" },
    { email: "noah@firm.test", by: "usr_other" }, { email: null, by: "usr_noemail" },
  ]);
  const m = createMembers({ db, active: (id) => id !== "usr_gone" });
  assert.deepEqual(await m.emails("spc"), [{ userId: "usr_noah", email: "noah@firm.test" }]);
});

test("a Space that has made no invitation has no members by email, instead of failing", async () => {
  const m = createMembers({ db: { all: () => { throw new Error("no such table: members_invites"); } }, active: () => true });
  assert.deepEqual(await m.emails("spc"), []);
});

test("a Space file is read through Files in pieces", async () => {
  const calls: string[] = [];
  const f = createFiles({
    call: async (cap, input) => {
      calls.push(`${cap}:${JSON.stringify(input)}`);
      if (cap === "files.get") return { file: { name: "letter.pdf", mime: "application/pdf", size: 6 } };
      const { offset } = input as { offset: number };
      return offset === 0 ? { base64: Buffer.from("abc").toString("base64"), truncated: true } : { base64: Buffer.from("def").toString("base64"), truncated: false };
    },
  });
  const file = await f.read("spc", "fil_1");
  assert.deepEqual([file.name, file.mime, Buffer.from(file.bytes).toString()], ["letter.pdf", "application/pdf", "abcdef"]);
  assert.equal(calls.length, 3);
  await assert.rejects(() => createFiles({ call: async () => ({ file: { size: 200 * 1024 * 1024 } }) }).read("spc", "fil_big"), /too large/);
});

test("downloaded bytes go into Files through an upload slot and come back as the blob id Files accepts", async () => {
  const put: { url: string; bytes: string }[] = [];
  const b = createBlobs({
    call: async (cap, input) => { assert.equal(cap, "files.upload_url"); assert.deepEqual(input, { size: 3, mime: "application/pdf" }); return { blobId: "blb_abc", url: "/spaces/spc/blobs/blb_abc?token=t" }; },
    putToSlot: async (url, bytes) => { put.push({ url, bytes: Buffer.from(bytes).toString() }); },
  });
  assert.equal(await b.put("spc", new TextEncoder().encode("pdf"), "application/pdf"), "blb_abc");
  assert.deepEqual(put, [{ url: "/spaces/spc/blobs/blb_abc?token=t", bytes: "pdf" }]);
  await assert.rejects(() => createBlobs({ call: async () => ({}), putToSlot: async () => undefined }).put("spc", new Uint8Array(1), "x/y"), /no upload slot/);
});
