// F50 (14 Nov 2026): two writers changing the same thing at once never lose work silently. On a booted daemon: two writes to one file on the same version (one lands, the other is told), and two agents asked together
// who write one file with no version in their tool call (every text that was reported as saved is in the file's History; the others were told). The kit is test/memory-live-kit.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, clock, connect, newAgent, say, seededDir } from "./memory-live-kit.ts";

let k = 0;
const c = (d: Parameters<typeof call>[0], cap: string, input: Record<string, unknown>) =>
  call(d, cap, { idempotencyKey: `aw-${cap}-${++k}`, ...input });

test("two files.write on one version at once: one 200, one 409, one History row per number", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    await connect(d);
    const tree = await c(d, "files.tree", {});
    const root = (tree.data.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
    const folder = (await c(d, "files.folder.create", { parentId: root, name: "S" })).data.folder.folderId;
    const f = (await c(d, "files.create", { folderId: folder, name: "race.txt", content: { text: "v1" } })).data.file
      .fileId;
    const rs = await Promise.all([
      c(d, "files.write", { fileId: f, content: { text: "ANN" }, baseVersion: 1 }),
      c(d, "files.write", { fileId: f, content: { text: "BOB" }, baseVersion: 1 }),
    ]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    const versions = (await c(d, "files.versions", { fileId: f })).data.versions as Array<{ n: number }>;
    assert.deepEqual(versions.map((v) => v.n).sort(), [1, 2]);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("two agents write one file at once with no version: what each is told saved is in History, and what is not was refused", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    await connect(d);
    const A = await newAgent(d, "Ann");
    const B = await newAgent(d, "Bob");
    const tree = await c(d, "files.tree", {});
    const root = (tree.data.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
    const folder = (await c(d, "files.folder.create", { parentId: root, name: "Shared" })).data.folder.folderId;
    for (const a of [A, B])
      await c(d, "access.share", {
        resource: { type: "folder", id: folder },
        subject: { kind: "agent", id: a.id },
        level: "edit",
      });
    const f = (await c(d, "files.create", { folderId: folder, name: "a.txt", content: { text: "v1 original" } })).data
      .file.fileId as string;
    const w = (agent: string, tag: string) =>
      say(
        d,
        agent,
        `TOOL files_write ${JSON.stringify({ fileId: f, content: { text: `edit by ${tag}` } })}`,
        `aw-${tag}`,
      );
    const [ra, rb] = await Promise.all([w(A.id, "ANN"), w(B.id, "BOB")]);
    const versions = (await c(d, "files.versions", { fileId: f })).data.versions as Array<{
      n: number;
      versionId: string;
    }>;
    const ns = versions.map((v) => v.n);
    assert.equal(new Set(ns).size, ns.length, `no number twice: ${ns.join(",")}`);
    const kept: string[] = [];
    for (const v of versions)
      kept.push(String((await c(d, "files.read", { fileId: f, versionId: v.versionId, as: "text" })).data.text));
    for (const [tag, r] of [
      ["ANN", ra],
      ["BOB", rb],
    ] as const) {
      const told = /TOOL RESULT ok/.test(r.reply);
      assert.equal(
        kept.includes(`edit by ${tag}`),
        told,
        `${tag} was told ${told ? "saved" : "refused"}; History holds ${JSON.stringify(kept)}; reply ${r.reply.slice(0, 300)}`,
      );
    }
    console.log(
      "MEASURE agents no version:",
      JSON.stringify({ ann: ra.reply.slice(0, 160), bob: rb.reply.slice(0, 160), kept }),
    );
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("two files.save on one version at once (the guidance-file path): one lands, the other is refused, no number twice", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    await connect(d);
    const tree = await c(d, "files.tree", {});
    const root = (tree.data.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
    const folder = (await c(d, "files.folder.create", { parentId: root, name: "G" })).data.folder.folderId;
    const f = (
      await c(d, "files.create", { folderId: folder, name: "VYRE.md", content: { text: "# Rules\n\nBe brief.\n" } })
    ).data.file.fileId;
    const rs = await Promise.all([
      c(d, "files.save", { fileId: f, text: "# Rules\n\nAnn's rule.\n", baseVersion: 1 }),
      c(d, "files.save", { fileId: f, text: "# Rules\n\nBob's rule.\n", baseVersion: 1 }),
    ]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409], JSON.stringify(rs.map((r) => r.data)).slice(0, 400));
    const versions = (await c(d, "files.versions", { fileId: f })).data.versions as Array<{ n: number }>;
    assert.deepEqual(versions.map((v) => v.n).sort(), [1, 2]);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("two agents change one record and one task at once with no version: exactly one change lands, the other agent is told to read again", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  let tick: ReturnType<typeof setInterval> | undefined;
  try {
    await connect(d);
    const A = await newAgent(d, "Ann");
    const B = await newAgent(d, "Bob");
    const rec = (await c(d, "records.create", { type: "contact", fields: { name: "Dana Fox" } })).data.record;
    const task = (
      await c(d, "tasks.create", { title: "Shared", summary: "o", assigned: { kind: "person", id: "usr_olivia" } })
    ).data.task;
    for (const a of [A, B]) {
      for (const [type, id] of [
        ["record", rec.id],
        ["task", task.id],
      ])
        await c(d, "access.share", { resource: { type, id }, subject: { kind: "agent", id: a.id }, level: "edit" });
    }
    clock.t = Date.now(); // the daemon's clock follows the wall clock here, as the record store's stamps do
    tick = setInterval(() => (clock.t = Date.now()), 1);
    const upd = (agent: string, tag: string) =>
      say(
        d,
        agent,
        `TOOL records_update ${JSON.stringify({ type: "contact", recordId: rec.id, patch: { name: tag } })}`,
        `wr-r-${tag}`,
      );
    const [ra, rb] = await Promise.all([upd(A.id, "ANN"), upd(B.id, "BOB")]);
    const told = [ra, rb].map((r) => /TOOL RESULT ok/.test(r.reply));
    console.log("MEASURE agents record:", JSON.stringify([ra.reply.slice(0, 120), rb.reply.slice(0, 120)]));
    assert.equal(told.filter(Boolean).length, 1, "exactly one record change landed");
    assert.ok(
      [ra, rb].some((r) => /changed after you last read it|changed after you started/.test(r.reply)),
      "the other was told to read again",
    );
    const tup = (agent: string, tag: string) =>
      say(d, agent, `TOOL tasks_update ${JSON.stringify({ taskId: task.id, summary: tag })}`, `wr-t-${tag}`);
    const [ta, tb] = await Promise.all([tup(A.id, "ANN"), tup(B.id, "BOB")]);
    console.log("MEASURE agents task:", JSON.stringify([ta.reply.slice(0, 120), tb.reply.slice(0, 120)]));
    assert.equal([ta, tb].filter((r) => /TOOL RESULT ok/.test(r.reply)).length, 1, "exactly one task change landed");
  } finally {
    if (tick) clearInterval(tick);
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
