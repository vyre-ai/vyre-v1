// The files viewer (spec 2.16, 2.4; ARCH 7.5): viewer_data for each kind of file, comments and numbered pins, freehand markup, and outside links with their expiry, revoke and limits.
// neighbours (previews, sheets) answer through a scripted ctx.call; files.* calls go to the real handlers. Refusals: a caller without access, restricted files, someone else's comment.
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /modules/files/migrations/0004_viewer.sql
// @reads /modules/files/handlers/viewer.ts
// @reads /generated/modules/files/schema.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { configureViewer, MAX_LINKS_PER_FILE } from "../handlers/viewer.ts";
import { open } from "../fixtures/lists-world.ts";

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type H = (ctx: Ctx, input: unknown) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (ctx: Ctx, cap: string, input: unknown = {}) =>
  (handlers as unknown as Record<string, H>)[cap]!(ctx, input);
const DAY = 86_400_000;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.message : "throw");
    return e.error.code;
  }
  return "none";
}

/** A world whose ctx.call runs the real files handlers and answers the neighbours from `extra`. */
function world(extra: (cap: string, input: Obj) => unknown = () => undefined, who = "per_maya") {
  let ctx!: Ctx;
  const w = open((cap, input) => {
    const e = extra(cap, (input ?? {}) as Obj);
    if (e !== undefined) return e;
    const h = (handlers as unknown as Record<string, H>)[cap];
    if (!h) throw new Error(`unscripted call ${cap}`);
    return h(ctx, input);
  }, who);
  ctx = w.ctx;
  return w;
}

async function personal(ctx: Ctx): Promise<string> {
  return (await call(ctx, "files.tree")).roots.find((r: Obj) => r.key === "personal").folderId;
}

async function make(
  ctx: Ctx,
  name: string,
  kind: string,
  content: Obj = { text: name },
  folderId?: string,
): Promise<string> {
  return (
    await call(ctx, "files.create", {
      folderId: folderId ?? (await personal(ctx)),
      name,
      kind,
      content,
      idempotencyKey: `k-${name}`,
    })
  ).file.fileId;
}

const deny = (ctx: Ctx, levels: string[]): Ctx => ({
  ...ctx,
  authorize: (a) =>
    ({ effect: levels.includes(a.level) ? "deny" : "allow", reason: "test", decisionId: "dec" }) as ReturnType<
      Ctx["authorize"]
    >,
});

// ---- viewer_data ---------------------------------------------------------------------------------------------------

test("viewer_data: a Markdown file shows its text and what the caller may do; a version that is not the file's is refused; a trashed file is not shown", async () => {
  const { ctx } = world();
  const id = await make(ctx, "note.md", "markdown", { text: "# Hello\n\nA note." });
  const v = await call(ctx, "files.viewer_data", { fileId: id });
  assert.equal(v.file.fileId, id);
  assert.equal(v.text, "# Hello\n\nA note.");
  assert.deepEqual([v.canEdit, v.canMark, v.canComment, v.pins], [true, false, true, 0], "text files are not drawn on");
  assert.equal(v.pages, undefined);
  assert.equal(v.previewUrl, undefined);
  assert.equal(
    await code(call(ctx, "files.viewer_data", { fileId: id, versionId: "ver_nope" })),
    "validation.not_found",
  );
  assert.equal(await code(call(ctx, "files.viewer_data", { fileId: "fil_nope" })), "validation.not_found");
  await call(ctx, "files.delete", { fileId: id });
  assert.equal(await code(call(ctx, "files.viewer_data", { fileId: id })), "validation.precondition_failed");
});

test("viewer_data: a PDF gets its pages, extracted text and preview address from previews; an image can be drawn on; a spreadsheet lists its sheets; a failing neighbour leaves its part out", async () => {
  const { ctx } = world((cap) => {
    if (cap === "previews.text") return { text: "Page one text", pages: 3, truncated: false, source: "pdf" };
    if (cap === "previews.get") return { ready: true, url: "/p/x.png", pages: 3 };
    if (cap === "sheets.info")
      return { sheets: [{ name: "Fees", rows: 12, columns: ["client", "fee"], keyColumn: "client" }] };
    return undefined;
  });
  const pdf = await make(ctx, "brief.pdf", "pdf", { base64: "JVBERi0=" });
  const v = await call(ctx, "files.viewer_data", { fileId: pdf });
  assert.deepEqual([v.text, v.pages, v.previewUrl, v.canMark], ["Page one text", 3, "/p/x.png", true]);
  const img = await make(ctx, "scan.png", "image", { base64: "iVBORw0=" });
  assert.equal((await call(ctx, "files.viewer_data", { fileId: img })).canMark, true);
  const xls = await make(ctx, "fees.xlsx", "spreadsheet", { base64: "UEsDBA==" });
  assert.deepEqual((await call(ctx, "files.viewer_data", { fileId: xls })).sheets, [
    { name: "Fees", rows: 12, columns: ["client", "fee"], keyColumn: "client" },
  ]);

  const down = world((cap) => {
    if (cap.startsWith("previews.") || cap === "sheets.info") throw new Error("converter is down");
    return undefined;
  });
  const pdf2 = await make(down.ctx, "b.pdf", "pdf", { base64: "JVBERi0=" });
  const d = await call(down.ctx, "files.viewer_data", { fileId: pdf2 });
  assert.equal(d.text, undefined);
  assert.equal(d.pages, undefined);
  assert.equal(d.file.fileId, pdf2, "the file itself still shows");
});

test("viewer_data: a Google-native file reads from its export snapshot; what the caller may do follows access; the pin count is the open pins", async () => {
  const { ctx } = world();
  const g = await make(ctx, "plan.gdoc", "google_native", { text: "exported" });
  const v = await call(ctx, "files.viewer_data", { fileId: g });
  assert.deepEqual(v.snapshot, { exportedAt: v.file.updatedAt, editVia: "open_in_provider" });
  assert.equal(v.canEdit, false, "a native file with no provider connection is edited in the provider");
  const f = await make(ctx, "pic.png", "image", { base64: "iVBORw0=" });
  await call(ctx, "files.comments.add", {
    fileId: f,
    anchor: { kind: "area", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    text: "look",
    idempotencyKey: "a",
  });
  const second = await call(ctx, "files.comments.add", {
    fileId: f,
    anchor: { kind: "area", box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
    text: "and here",
    idempotencyKey: "b",
  });
  await call(ctx, "files.comments.add", { fileId: f, anchor: { kind: "file" }, text: "general", idempotencyKey: "c" });
  assert.equal((await call(ctx, "files.viewer_data", { fileId: f })).pins, 2);
  await call(ctx, "files.comments.resolve", { commentId: second.comment.commentId, resolved: true });
  assert.equal((await call(ctx, "files.viewer_data", { fileId: f })).pins, 1, "a resolved pin is not open");
  const viewOnly = deny(ctx, ["edit", "use", "manage"]);
  const r = await call(viewOnly, "files.viewer_data", { fileId: f });
  assert.deepEqual([r.canEdit, r.canMark, r.canComment], [false, false, false]);
});

// ---- comments ---------------------------------------------------------------------------------------------------------

test("comments: add keeps the anchor, mentions and author; area comments are numbered pins that are never reused; list is oldest first and hides resolved ones unless asked", async () => {
  const { ctx, events } = world();
  const f = await make(ctx, "pic.png", "image", { base64: "iVBORw0=" });
  const a = (
    await call(ctx, "files.comments.add", {
      fileId: f,
      anchor: { kind: "area", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, page: 2 },
      text: "  Check this  ",
      mentions: ["per_omar", "per_omar", "agt_clerk"],
      idempotencyKey: "a",
    })
  ).comment;
  assert.deepEqual(
    { ...a, commentId: "x", at: 0 },
    {
      commentId: "x",
      fileId: f,
      anchor: { kind: "area", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, page: 2 },
      pin: 1,
      text: "Check this",
      by: "per_maya",
      at: 0,
      resolved: false,
      mentions: ["per_omar", "agt_clerk"],
    },
  );
  assert.deepEqual(events.at(-1), {
    name: "file.comment_added",
    payload: { fileId: f, commentId: a.commentId, pin: 1, mentions: ["per_omar", "agt_clerk"] },
  });
  const b = (
    await call(ctx, "files.comments.add", {
      fileId: f,
      anchor: { kind: "area", box: { x: 0, y: 0, w: 1, h: 1 } },
      text: "second",
      idempotencyKey: "b",
    })
  ).comment;
  assert.equal(b.pin, 2);
  const line = (
    await call(ctx, "files.comments.add", {
      fileId: f,
      anchor: { kind: "line", line: 4, quote: "text" },
      text: "a line",
      idempotencyKey: "c",
    })
  ).comment;
  assert.equal(line.pin, undefined, "only area comments are pins");
  assert.equal(await call(ctx, "files.comments.delete", { commentId: b.commentId }).then((r: Obj) => r.deleted), true);
  const c = (
    await call(ctx, "files.comments.add", {
      fileId: f,
      anchor: { kind: "area", box: { x: 0, y: 0, w: 1, h: 1 } },
      text: "third",
      idempotencyKey: "d",
    })
  ).comment;
  assert.equal(c.pin, 3, "pin 2 was deleted and is not reused");
  await call(ctx, "files.comments.resolve", { commentId: a.commentId, resolved: true });
  const open = (await call(ctx, "files.comments.list", { fileId: f })).comments;
  assert.deepEqual(
    open.map((x: Obj) => x.text),
    ["a line", "third"],
    "resolved and deleted comments are hidden",
  );
  const all = (await call(ctx, "files.comments.list", { fileId: f, includeResolved: true })).comments;
  assert.deepEqual(
    all.map((x: Obj) => x.text),
    ["Check this", "a line", "third"],
    "oldest first",
  );
});

test("comments: every anchor kind is checked and trimmed to its own fields; bad anchors, text and mentions are refused", async () => {
  const { ctx } = world();
  const f = await make(ctx, "doc.md", "markdown");
  const add = (anchor: unknown, over: Obj = {}) =>
    call(ctx, "files.comments.add", { fileId: f, anchor, text: "t", idempotencyKey: `k${Math.random()}`, ...over });
  assert.deepEqual((await add({ kind: "range", from: 3, to: 9, line: 99, page: 5 })).comment.anchor, {
    kind: "range",
    from: 3,
    to: 9,
  });
  assert.deepEqual((await add({ kind: "cell", cell: "B7", path: "Fees" })).comment.anchor, {
    kind: "cell",
    cell: "B7",
    path: "Fees",
  });
  assert.deepEqual((await add({ kind: "page", page: 2 })).comment.anchor, { kind: "page", page: 2 });
  for (const bad of [
    null,
    "x",
    {},
    { kind: "nope" },
    { kind: "line" },
    { kind: "line", line: 0 },
    { kind: "range", from: 5, to: 2 },
    { kind: "range", from: -1, to: 2 },
    { kind: "page", page: 0 },
    { kind: "cell" },
    { kind: "area" },
    { kind: "area", box: { x: 0, y: 0, w: -1, h: 1 } },
    { kind: "area", box: { x: "a", y: 0, w: 1, h: 1 } },
    { kind: "file", quote: "x".repeat(501) },
  ]) {
    assert.equal(await code(add(bad)), "validation.bad_input", JSON.stringify(bad));
  }
  assert.equal(await code(add({ kind: "file" }, { text: "   " })), "validation.bad_input");
  assert.equal(await code(add({ kind: "file" }, { text: "x".repeat(5001) })), "validation.bad_input");
  assert.equal(
    await code(add({ kind: "file" }, { mentions: Array.from({ length: 21 }, (_, i) => `p${i}`) })),
    "validation.bad_input",
  );
  assert.equal(await code(add({ kind: "file" }, { mentions: [""] })), "validation.bad_input");
  assert.equal(await code(add({ kind: "file" }, { versionId: "ver_nope" })), "validation.not_found");
  assert.equal(await code(add({ kind: "file" }, { fileId: "fil_nope" })), "validation.not_found");
});

test("comments: a comment made on a version shows on that version and on the file; resolve and reopen change one comment; resolve and delete check the comment's file", async () => {
  const { ctx, events } = world();
  const f = await make(ctx, "doc.md", "markdown", { text: "v1" });
  await call(ctx, "files.write", { fileId: f, content: { text: "v2" }, idempotencyKey: "w" });
  const versions = (await call(ctx, "files.versions", { fileId: f })).versions;
  const v1 = versions.find((v: Obj) => v.n === 1).versionId;
  const v2 = versions.find((v: Obj) => v.n === 2).versionId;
  const onV1 = (
    await call(ctx, "files.comments.add", {
      fileId: f,
      versionId: v1,
      anchor: { kind: "file" },
      text: "old",
      idempotencyKey: "1",
    })
  ).comment;
  await call(ctx, "files.comments.add", {
    fileId: f,
    versionId: v2,
    anchor: { kind: "file" },
    text: "new",
    idempotencyKey: "2",
  });
  await call(ctx, "files.comments.add", { fileId: f, anchor: { kind: "file" }, text: "any", idempotencyKey: "3" });
  assert.deepEqual(
    (await call(ctx, "files.comments.list", { fileId: f, versionId: v1 })).comments.map((c: Obj) => c.text),
    ["old", "any"],
  );
  assert.equal(onV1.versionId, v1);

  const done = await call(ctx, "files.comments.resolve", { commentId: onV1.commentId, resolved: true });
  assert.equal(done.comment.resolved, true);
  assert.equal(events.at(-1)!.name, "file.comment_resolved");
  const n = events.length;
  await call(ctx, "files.comments.resolve", { commentId: onV1.commentId, resolved: true });
  assert.equal(events.length, n, "resolving twice says nothing twice");
  assert.equal(
    (await call(ctx, "files.comments.resolve", { commentId: onV1.commentId, resolved: false })).comment.resolved,
    false,
  );
  assert.equal(
    await code(call(ctx, "files.comments.resolve", { commentId: onV1.commentId, resolved: "yes" })),
    "validation.bad_input",
  );
  assert.equal(
    await code(call(ctx, "files.comments.resolve", { commentId: "fcm_nope", resolved: true })),
    "validation.not_found",
  );

  // someone without access to the file cannot resolve; only the author or a manager can delete
  assert.equal(
    await code(
      call(deny(ctx, ["use", "edit", "manage"]), "files.comments.resolve", {
        commentId: onV1.commentId,
        resolved: true,
      }),
    ),
    "permission.no_grant",
  );
  const other = { ...ctx, principal: { kind: "person" as const, id: "per_omar" } };
  assert.equal(
    await code(call(deny(other, ["manage"]), "files.comments.delete", { commentId: onV1.commentId })),
    "permission.no_grant",
  );
  assert.equal(
    (await call(other, "files.comments.delete", { commentId: onV1.commentId })).deleted,
    true,
    "a manager may delete it",
  );
  assert.equal(
    (await call(ctx, "files.comments.delete", { commentId: onV1.commentId })).deleted,
    false,
    "and it is gone",
  );
});

// ---- markup -----------------------------------------------------------------------------------------------------------

test("markup: strokes save per page, replace that page's earlier strokes, read back with their page, and an empty save clears the page", async () => {
  const { ctx, events } = world();
  const f = await make(ctx, "scan.png", "image", { base64: "iVBORw0=" });
  const s1 = {
    color: "#d32f2f",
    width: 3,
    points: [
      [0.1, 0.1],
      [0.2, 0.3],
    ],
  };
  const s2 = { color: "#1565c0cc", width: 1.5, points: [[0.5, 0.5]] };
  assert.deepEqual(await call(ctx, "files.markup.save", { fileId: f, strokes: [s1] }), { ok: true });
  assert.deepEqual(events.at(-1), { name: "file.markup_saved", payload: { fileId: f } });
  await call(ctx, "files.markup.save", { fileId: f, page: 2, strokes: [s2] });
  assert.deepEqual((await call(ctx, "files.markup.get", { fileId: f })).strokes, [s1, { page: 2, ...s2 }]);
  assert.deepEqual((await call(ctx, "files.markup.get", { fileId: f, page: 2 })).strokes, [{ page: 2, ...s2 }]);
  await call(ctx, "files.markup.save", { fileId: f, strokes: [s2] });
  assert.deepEqual((await call(ctx, "files.markup.get", { fileId: f, page: 1 })).strokes, [], "page 1 holds nothing");
  assert.deepEqual(
    (await call(ctx, "files.markup.get", { fileId: f })).strokes,
    [s2, { page: 2, ...s2 }],
    "saving page 0 replaced its strokes",
  );
  await call(ctx, "files.markup.save", { fileId: f, page: 2, strokes: [] });
  assert.deepEqual((await call(ctx, "files.markup.get", { fileId: f })).strokes, [s2]);
});

test("markup: bad strokes, a page below 1, a file that is not an image or a page, and a missing file are refused; nothing is saved", async () => {
  const { ctx } = world();
  const f = await make(ctx, "scan.png", "image", { base64: "iVBORw0=" });
  const ok = { color: "#000", width: 1, points: [[0, 0]] };
  for (const bad of [
    [{ ...ok, color: "red" }],
    [{ ...ok, color: "#12" }],
    [{ ...ok, width: 0 }],
    [{ ...ok, width: 65 }],
    [{ ...ok, points: [] }],
    [{ ...ok, points: [[0]] }],
    [{ ...ok, points: [[0, "a"]] }],
    [{ ...ok, points: [[0, Infinity]] }],
    ["x"],
    [null],
  ]) {
    assert.equal(
      await code(call(ctx, "files.markup.save", { fileId: f, strokes: bad })),
      "validation.bad_input",
      JSON.stringify(bad),
    );
  }
  assert.equal(
    await code(call(ctx, "files.markup.save", { fileId: f, strokes: Array.from({ length: 2001 }, () => ok) })),
    "validation.bad_input",
  );
  assert.equal(
    await code(
      call(ctx, "files.markup.save", {
        fileId: f,
        strokes: [{ ...ok, points: Array.from({ length: 5001 }, () => [0, 0]) }],
      }),
    ),
    "validation.bad_input",
  );
  assert.equal(
    await code(call(ctx, "files.markup.save", { fileId: f, page: 0, strokes: [ok] })),
    "validation.bad_input",
  );
  assert.equal(await code(call(ctx, "files.markup.get", { fileId: f, page: 0 })), "validation.bad_input");
  const big = Array.from({ length: 1500 }, () => ({
    color: "#000000",
    width: 1,
    points: Array.from({ length: 300 }, (_, i) => [i / 1000, i / 1000]),
  }));
  assert.equal(await code(call(ctx, "files.markup.save", { fileId: f, strokes: big })), "validation.too_large");
  const md = await make(ctx, "n.md", "markdown");
  assert.equal(
    await code(call(ctx, "files.markup.save", { fileId: md, strokes: [ok] })),
    "validation.precondition_failed",
  );
  assert.equal(
    await code(call(ctx, "files.markup.save", { fileId: "fil_nope", strokes: [ok] })),
    "validation.not_found",
  );
  assert.deepEqual((await call(ctx, "files.markup.get", { fileId: f })).strokes, []);
});

// ---- outside links -----------------------------------------------------------------------------------------------------

test("share_external: makes a view-only link with a 30 day default expiry, stores only the token's hash, lists it, and the list never shows the token", async () => {
  configureViewer({ publicBase: "https://harbor.example/" });
  const { ctx, events, db } = world();
  const f = await make(ctx, "letter.pdf", "pdf", { base64: "JVBERi0=" });
  const now = ctx.now();
  const out = await call(ctx, "files.share_external", { fileId: f, idempotencyKey: "s1" });
  assert.match(out.url, /^https:\/\/harbor\.example\/x\/[0-9a-f]{64}$/);
  assert.match(out.linkId, /^lnk_[0-9a-f]+$/);
  assert.ok(Math.abs(out.expiresAt - (now + 30 * DAY)) < 1000);
  assert.deepEqual(events.at(-1), {
    name: "file.shared_external",
    payload: { fileId: f, linkId: out.linkId, expiresAt: out.expiresAt },
  });
  const token = out.url.split("/x/")[1];
  const row = db.rows("files_external_link")[0]!;
  assert.notEqual(row["token_hash"], token, "the token itself is not stored");
  assert.match(String(row["token_hash"]), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(db.rows("files_external_link")).includes(token), false);
  const list = await call(ctx, "files.external_links", { fileId: f });
  assert.deepEqual(
    list.links.map((l: Obj) => [l.linkId, l.createdBy, l.opens]),
    [[out.linkId, "per_maya", 0]],
  );
  assert.equal(JSON.stringify(list).includes(token), false);
  configureViewer(null);
  assert.match(
    (await call(ctx, "files.share_external", { fileId: f, idempotencyKey: "s2" })).url,
    /^\/x\/[0-9a-f]{64}$/,
    "with no public base the url is a path",
  );
});

test("share_external: an expiry must be in the future and within a year; restricted files are refused; at most 20 live links per file; trashed and missing files are refused", async () => {
  const { ctx, db } = world();
  const f = await make(ctx, "letter.pdf", "pdf", { base64: "JVBERi0=" });
  const t = ctx.now();
  assert.equal(
    (await call(ctx, "files.share_external", { fileId: f, expiresAt: t + 2 * DAY, idempotencyKey: "a" })).expiresAt,
    t + 2 * DAY,
  );
  for (const bad of [t - 1, t, t + 366 * DAY, "soon", Infinity])
    assert.equal(
      await code(call(ctx, "files.share_external", { fileId: f, expiresAt: bad, idempotencyKey: "b" })),
      "validation.bad_input",
      String(bad),
    );
  assert.equal(
    await code(call(ctx, "files.share_external", { fileId: "fil_nope", idempotencyKey: "c" })),
    "validation.not_found",
  );

  const personalId = await personal(ctx);
  ctx.db.run("UPDATE files_folder SET label = ? WHERE id = ?", 3, personalId);
  assert.equal(
    await code(call(ctx, "files.share_external", { fileId: f, idempotencyKey: "d" })),
    "permission.above_clearance",
  );
  ctx.db.run("UPDATE files_folder SET label = ? WHERE id = ?", 2, personalId);
  assert.equal(
    (await call(ctx, "files.share_external", { fileId: f, idempotencyKey: "e" })).linkId.startsWith("lnk_"),
    true,
    "confidential files may be shared with a client",
  );

  for (let i = 0; i < MAX_LINKS_PER_FILE - 2; i++)
    await call(ctx, "files.share_external", { fileId: f, idempotencyKey: `n${i}` });
  assert.equal(db.rows("files_external_link").length, MAX_LINKS_PER_FILE);
  assert.equal(
    await code(call(ctx, "files.share_external", { fileId: f, idempotencyKey: "over" })),
    "validation.precondition_failed",
  );
  const first = db.rows("files_external_link")[0]!["id"] as string;
  await call(ctx, "files.revoke_external", { fileId: f, linkId: first });
  assert.equal(
    (await call(ctx, "files.share_external", { fileId: f, idempotencyKey: "again" })).linkId.startsWith("lnk_"),
    true,
    "a revoked link frees a place",
  );
  await call(ctx, "files.delete", { fileId: f });
  assert.equal(
    await code(call(ctx, "files.share_external", { fileId: f, idempotencyKey: "gone" })),
    "validation.precondition_failed",
  );
});

test("share_external: a file anywhere below a Restricted folder is Restricted; files.get says so, and no outside link is made (lead ruling 3 Nov)", async () => {
  const { ctx } = world();
  const top = (
    await call(ctx, "files.folder.create", { parentId: await personal(ctx), name: "HR", idempotencyKey: "hr" })
  ).folder.folderId;
  const pay = (await call(ctx, "files.folder.create", { parentId: top, name: "Pay", idempotencyKey: "pay" })).folder
    .folderId;
  const f = await make(ctx, "payroll.pdf", "pdf", { base64: "JVBERi0=" }, pay);
  assert.equal((await call(ctx, "files.get", { fileId: f })).file.label, 0);
  ctx.db.run("UPDATE files_folder SET label = ? WHERE id = ?", 3, top);
  const next: Ctx = { ...ctx }; // a new call: the per-call folder cache starts empty
  assert.equal(
    (await call(next, "files.get", { fileId: f })).file.label,
    3,
    "the file reports the label it inherits from two folders up",
  );
  assert.equal(
    await code(call(next, "files.share_external", { fileId: f, idempotencyKey: "deep" })),
    "permission.above_clearance",
  );
});

test("revoke_external: revokes one link of that file once, says so once, drops it from the list, is repeatable, and refuses another file's link", async () => {
  const { ctx, events } = world();
  const a = await make(ctx, "a.pdf", "pdf", { base64: "JVBERi0=" });
  const b = await make(ctx, "b.pdf", "pdf", { base64: "JVBERi0=" });
  const l1 = (await call(ctx, "files.share_external", { fileId: a, idempotencyKey: "1" })).linkId;
  const l2 = (await call(ctx, "files.share_external", { fileId: a, idempotencyKey: "2" })).linkId;
  assert.equal(
    await code(call(ctx, "files.revoke_external", { fileId: b, linkId: l1 })),
    "validation.not_found",
    "a link is revoked through its own file",
  );
  assert.equal(
    await code(call(ctx, "files.revoke_external", { fileId: a, linkId: "lnk_nope" })),
    "validation.not_found",
  );
  assert.deepEqual(await call(ctx, "files.revoke_external", { fileId: a, linkId: l1 }), { ok: true });
  assert.deepEqual(events.at(-1), { name: "file.external_revoked", payload: { fileId: a, linkId: l1 } });
  const n = events.length;
  assert.deepEqual(await call(ctx, "files.revoke_external", { fileId: a, linkId: l1 }), { ok: true });
  assert.equal(events.length, n, "revoking again says nothing again");
  assert.deepEqual(
    (await call(ctx, "files.external_links", { fileId: a })).links.map((l: Obj) => l.linkId),
    [l2],
  );
  assert.deepEqual((await call(ctx, "files.external_links", { fileId: b })).links, []);
  assert.equal(await code(call(ctx, "files.external_links", { fileId: "fil_nope" })), "validation.not_found");
});

test("mounted files get their kind the way the mount engine creates them (a name and the provider's mime, no kind), so each opens in the same viewer as a local file of its type", async () => {
  const { ctx } = world();
  const folderId = await personal(ctx);
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const cases: Array<[name: string, mime: string | undefined, kind: string]> = [
    ["Report.docx", DOCX, "document"],
    ["Export", DOCX, "document"],
    ["Budget.xlsx", undefined, "spreadsheet"],
    ["Deck", PPTX, "presentation"],
    ["scan.pdf", "application/pdf", "pdf"],
    ["photo", "image/jpeg", "image"],
    ["logo.svg", undefined, "image"],
    ["README.md", undefined, "markdown"],
    ["main.go", undefined, "code"],
    ["ci.yml", undefined, "code"],
    ["notes.txt", undefined, "text"],
  ];
  for (const [name, mime, kind] of cases) {
    const made = await call(ctx, "files.create", {
      folderId,
      name,
      content: { text: "x" },
      ...(mime ? { mime } : {}),
      idempotencyKey: `kind-${name}`,
    });
    assert.equal(made.file.kind, kind, `${name} (${mime ?? "no mime"})`);
  }
});

// ---- a spreadsheet's rows, and a live file whose content is not here yet (13 Nov 2026: a Drive CSV opened as "0 rows, 0 columns") -------------------------------------------------------------

/** A live Drive folder and an empty placeholder in it, as the mounts engine makes them. `open` is what mounts.open does when the viewer asks. */
async function drive(
  open: (ctx: Ctx, fileId: string) => Promise<unknown>,
  extra: (cap: string, i: Obj) => unknown = () => undefined,
) {
  let ctx!: Ctx;
  const w = world((cap, input) => {
    const e = extra(cap, input);
    if (e !== undefined) return e;
    if (cap === "mounts.open") return open(ctx, String(input.fileId));
    return undefined;
  });
  ctx = w.ctx;
  const root = await personal(ctx);
  const drv = (await call(ctx, "files.folder.create", { parentId: root, name: "My Drive", idempotencyKey: "drv" }))
    .folder.folderId as string;
  await call(ctx, "files.folder.settings", {
    folderId: drv,
    source: { mountId: "mnt_drive", provider: "Google Drive" },
  });
  const placeholder = async (name: string, mime: string): Promise<string> =>
    (await call(ctx, "files.create", { folderId: drv, name, mime, idempotencyKey: `ph-${name}` })).file.fileId;
  return { ctx, placeholder };
}
const CSV = "client,fee\nAcme,10\nBeta,20\n";

test("viewer_data: a CSV carries its text, so the grid has rows (a spreadsheet kind used to arrive with no text at all)", async () => {
  const { ctx } = world();
  const id = await make(ctx, "fees.csv", "spreadsheet", { text: CSV });
  const v = await call(ctx, "files.viewer_data", { fileId: id });
  assert.equal(v.text, CSV);
});

test("viewer_data: a big CSV is cut at a whole row, never shown empty", async () => {
  const { ctx } = world();
  const rows = Array.from({ length: 13_000 }, (_, i) => `client ${i},${i}`);
  const id = await make(ctx, "big.csv", "spreadsheet", { text: `client,fee\n${rows.join("\n")}\n` });
  const v = await call(ctx, "files.viewer_data", { fileId: id });
  assert.ok(typeof v.text === "string" && v.text.length > 1000 && v.text.length < 262_144, `${v.text?.length}`);
  assert.ok(v.text.endsWith("\n"), "the cut falls between rows");
  assert.ok(v.text.startsWith("client,fee\n"));
});

test("viewer_data: a workbook's first sheet arrives as CSV text for the grid", async () => {
  const { ctx } = world((cap) => {
    if (cap === "sheets.info") return { sheets: [{ name: "Fees", rows: 2, columns: ["client", "fee"] }] };
    if (cap === "sheets.read_rows")
      return {
        rows: [
          { rowId: "r1", values: { client: "Acme", fee: 10 } },
          { rowId: "r2", values: { client: "Beta, Inc", fee: 20 } },
        ],
        total: 2,
      };
    return undefined;
  });
  const xls = await make(ctx, "fees.xlsx", "spreadsheet", { base64: "UEsDBA==" });
  const v = await call(ctx, "files.viewer_data", { fileId: xls });
  assert.equal(v.text, 'client,fee\nAcme,10\n"Beta, Inc",20\n');
});

test("viewer_data: a live placeholder is fetched before it is read, so the first open shows the content, never the empty placeholder", async () => {
  const { ctx, placeholder } = await drive(async (c, fileId) => {
    await call(c, "files.write", { fileId, content: { text: CSV }, reason: "Fetched from Google Drive" });
    return { mounted: true, fetched: true, source: { cached: true } };
  });
  const id = await placeholder("1 - Wallet Recharge.csv", "text/csv");
  assert.equal((await call(ctx, "files.get", { fileId: id })).file.size, 0, "it starts as an empty placeholder");
  const v = await call(ctx, "files.viewer_data", { fileId: id });
  assert.equal(v.text, CSV);
  assert.equal(v.file.size, CSV.length);
});

test("viewer_data and files.read: when a live file cannot be fetched they say so, they never hand over the empty placeholder", async () => {
  const down = new VyreErr({
    code: "provider.unavailable",
    message: "Drive is down.",
    retryable: true,
    traceId: "t",
    next: [],
  });
  const { ctx, placeholder } = await drive(async () => {
    throw down;
  });
  const id = await placeholder("fees.csv", "text/csv");
  assert.equal(await code(call(ctx, "files.viewer_data", { fileId: id })), "provider.unavailable");
  assert.equal(await code(call(ctx, "files.read", { fileId: id, as: "text" })), "provider.unavailable");
  // an answer of "not cached" with no error is the same: the content is not here
  const quiet = await drive(async () => ({ mounted: true, fetched: false, source: { cached: false } }));
  const q = await quiet.placeholder("fees.csv", "text/csv");
  assert.equal(await code(call(quiet.ctx, "files.viewer_data", { fileId: q })), "provider.unavailable");
});

test("viewer_data: a live file that really is empty in Drive opens as an empty file (cached, zero bytes)", async () => {
  const { ctx, placeholder } = await drive(async () => ({ mounted: true, fetched: false, source: { cached: true } }));
  const id = await placeholder("blank.csv", "text/csv");
  const v = await call(ctx, "files.viewer_data", { fileId: id });
  assert.equal(v.file.size, 0);
});

test("every viewer kind gets its content: csv, a two-sheet workbook, pdf, image, markdown, text (a kind whose content never reaches the viewer is the bug class behind the 0 rows grid)", async () => {
  const { ctx } = world((cap, i) => {
    if (cap === "sheets.info")
      return {
        sheets: [
          { name: "Fees", rows: 1, columns: ["client", "fee"] },
          { name: "Costs", rows: 1, columns: ["item", "cost"] },
        ],
      };
    if (cap === "sheets.read_rows") return { rows: [{ rowId: "r1", values: { client: "Acme", fee: 10 } }], total: 1 };
    if (cap === "previews.text") return { text: "Page one text", pages: 2, truncated: false, source: "pdf" };
    if (cap === "previews.get") return { ready: true, url: "/p/x.png", pages: 2 };
    return undefined;
  });
  const csv = await call(ctx, "files.viewer_data", { fileId: await make(ctx, "a.csv", "spreadsheet", { text: CSV }) });
  assert.equal(csv.text, CSV);
  const xls = await call(ctx, "files.viewer_data", {
    fileId: await make(ctx, "b.xlsx", "spreadsheet", { base64: "UEsDBA==" }),
  });
  assert.equal(xls.sheets.length, 2);
  assert.match(xls.text, /Acme/);
  const pdf = await call(ctx, "files.viewer_data", { fileId: await make(ctx, "c.pdf", "pdf", { base64: "JVBERi0=" }) });
  assert.equal(pdf.text, "Page one text");
  assert.equal(pdf.previewUrl, "/p/x.png");
  const img = await call(ctx, "files.viewer_data", {
    fileId: await make(ctx, "d.png", "image", { base64: "iVBORw0=" }),
  });
  assert.equal(img.previewUrl, "/p/x.png");
  const md = await call(ctx, "files.viewer_data", { fileId: await make(ctx, "e.md", "markdown", { text: "# Hi" }) });
  assert.equal(md.text, "# Hi");
  const txt = await call(ctx, "files.viewer_data", { fileId: await make(ctx, "f.txt", "text", { text: "plain" }) });
  assert.equal(txt.text, "plain");
});

test("live image, PDF and Word placeholders: fetched before they are shown, and an error (never an empty picture or page) when the fetch fails", async () => {
  const down = new VyreErr({
    code: "provider.unavailable",
    message: "Drive is down.",
    retryable: true,
    traceId: "t",
    next: [],
  });
  const neighbours = (cap: string): unknown => {
    if (cap === "previews.text") return { text: "Words", pages: 1, truncated: false, source: "pdf" };
    if (cap === "previews.get") return { ready: true, url: "/p/y.png", pages: 1 };
    return undefined;
  };
  const files: [string, string, string][] = [
    ["MLA logo.png", "image/png", "iVBORw0="],
    ["brief.pdf", "application/pdf", "JVBERi0="],
    ["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "UEsDBA=="],
  ];
  for (const [name, mime, b64] of files) {
    const ok = await drive(async (c, fileId) => {
      await call(c, "files.write", { fileId, content: { base64: b64 }, reason: "Fetched from Google Drive" });
      return { mounted: true, fetched: true, source: { cached: true } };
    }, neighbours);
    const id = await ok.placeholder(name, mime);
    const v = await call(ok.ctx, "files.viewer_data", { fileId: id });
    assert.ok(v.file.size > 0, `${name} has its bytes`);
    assert.ok(v.previewUrl !== undefined || v.text !== undefined, `${name} shows something`);
    const bad = await drive(async () => {
      throw down;
    }, neighbours);
    const badId = await bad.placeholder(name, mime);
    assert.equal(await code(call(bad.ctx, "files.viewer_data", { fileId: badId })), "provider.unavailable", name);
  }
});

test("content fetched from a provider as a generic blob is stored under the file's own type", async () => {
  const { ctx } = world();
  const holder = await make(ctx, "raw.bin", "other", { base64: "iVBORw0=" });
  const blobId = String((ctx.db.all("SELECT * FROM files_file WHERE id = ?", holder) as Obj[])[0]!.blob);
  ctx.db.run("UPDATE files_blob SET mime = ? WHERE id = ?", "application/octet-stream", blobId);
  const csv = await make(ctx, "fees.csv", "spreadsheet", { text: "a\n" });
  await call(ctx, "files.write", { fileId: csv, content: { blobId } });
  assert.equal((ctx.db.all("SELECT * FROM files_blob WHERE id = ?", blobId) as Obj[])[0]!.mime, "text/csv");
});

// ---- every door to a live file's content goes through the one fetch-or-fail path ----

test("sheets.* on a live Drive CSV that is not fetched: each read fails (never 0 rows) and each write fails (the empty placeholder is never written back over the real file)", async () => {
  const down = new VyreErr({
    code: "provider.unavailable",
    message: "Drive is down.",
    retryable: true,
    traceId: "t",
    next: [],
  });
  const { ctx, placeholder } = await drive(async () => {
    throw down;
  });
  const id = await placeholder("fees.csv", "text/csv");
  const before = (await call(ctx, "files.get", { fileId: id })).file;
  const doors: [string, Obj][] = [
    ["sheets.info", { fileId: id }],
    ["sheets.read_rows", { fileId: id }],
    ["sheets.append_rows", { fileId: id, rows: [{ a: "1" }] }],
    ["sheets.update_row", { fileId: id, rowId: "r1", values: { a: "1" } }],
    ["sheets.upsert_row", { fileId: id, values: { a: "1" }, match: ["a"] }],
    ["sheets.delete_row", { fileId: id, rowId: "r1" }],
  ];
  for (const [cap, input] of doors) assert.equal(await code(call(ctx, cap, input)), "provider.unavailable", cap);
  const after = (await call(ctx, "files.get", { fileId: id })).file;
  assert.deepEqual(
    [after.size, after.version],
    [before.size, before.version],
    "nothing was written to the placeholder",
  );
});

test("sheets.read_rows on a live CSV that is not fetched yet fetches it first, then reads its rows", async () => {
  const { ctx, placeholder } = await drive(async (c, fileId) => {
    await call(c, "files.write", { fileId, content: { text: CSV }, reason: "Fetched from Google Drive" });
    return { mounted: true, fetched: true, source: { cached: true } };
  });
  const id = await placeholder("fees.csv", "text/csv");
  const r = await call(ctx, "sheets.read_rows", { fileId: id });
  assert.equal(r.total, 2);
});

test("a live file that cannot be fetched says why: an expired sign-in, a rate limit, a file removed at the provider each reach the caller as themselves; anything else is the generic not-here-just-now", async () => {
  for (const c of ["provider.auth_failed", "provider.rate_limited", "validation.not_found", "timeout.provider"]) {
    const e = new VyreErr({ code: c as never, message: "x", retryable: false, traceId: "t", next: [] });
    const d = await drive(async () => {
      throw e;
    });
    const id = await d.placeholder("fees.csv", "text/csv");
    assert.equal(await code(call(d.ctx, "files.viewer_data", { fileId: id })), c);
    assert.equal(await code(call(d.ctx, "files.read", { fileId: id, as: "text" })), c);
  }
  const odd = new VyreErr({ code: "validation.bad_input", message: "x", retryable: false, traceId: "t", next: [] });
  const d = await drive(async () => {
    throw odd;
  });
  const id = await d.placeholder("fees.csv", "text/csv");
  assert.equal(await code(call(d.ctx, "files.viewer_data", { fileId: id })), "provider.unavailable");
});
