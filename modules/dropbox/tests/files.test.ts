// @reads /modules/dropbox/handlers/files.ts
// The Dropbox file calls (live folders L3): listing with the change feed, metadata, downloads, conditional uploads, folders, deletes, revisions, restore and the long poll, replayed against recorded
// Dropbox bodies. A deleted item is named by the id the mount knew it by, a write that names a revision never overwrites, and every Dropbox refusal maps to the error catalogue.
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/dropbox.ts";
import * as d from "../handlers/index.ts";
import { useContract, RECORDED, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

useContract(manifest);

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const CON = "con_dbx0001";
const API = "api.dropboxapi.com/2/files";
const rpc = (h: Harness, p: string, ...r: Parameters<Harness["on"]>[1][]) => h.on(`POST ${API}/${p}`, ...r);

function ready(): Harness {
  const h = harness();
  h.connect();
  return h;
}

test("list_folder maps entries, passes the recursive flag, and the token goes as a bearer", async () => {
  const h = ready();
  rpc(h, "list_folder", { status: 200, body: { entries: [RECORDED.folder, RECORDED.file, RECORDED.sub, RECORDED.deep], cursor: "c1", has_more: true } });
  const r = out(await d.listFolder(h.ctx, { connectionId: CON, path: "/Sales", recursive: true, limit: 500 }));
  assert.deepEqual(contractErrors("dropbox.files.list_folder", "out", r), []);
  assert.deepEqual([r["cursor"], r["hasMore"]], ["c1", true]);
  const entries = r["entries"] as Json[];
  assert.deepEqual(entries.map((e) => [e["id"], e["isFolder"], e["rev"]]), [["id:fold1", true, undefined], ["id:file1", false, "015ab0c1d2e3f4a5"], ["id:fold2", true, undefined], ["id:file2", false, "015ab0c1d2e3f4b6"]]);
  const req = h.api()[0]!;
  assert.deepEqual(req.body, { path: "/Sales", recursive: true, include_deleted: false, include_non_downloadable_files: true, limit: 500 });
  assert.equal(req.headers["authorization"], "Bearer tok-1");
  assert.equal(req.headers["content-type"], "application/json");
  assert.deepEqual(h.tokenAsks[0], { refreshHandle: "#Dropbox_tok0" });
});

test("a cursor continues the listing and ignores everything else in the input", async () => {
  const h = ready();
  rpc(h, "list_folder/continue", { status: 200, body: { entries: [RECORDED.file], cursor: "c2", has_more: false } });
  const r = out(await d.listFolder(h.ctx, { connectionId: CON, cursor: "c1", path: "/ignored" }));
  assert.deepEqual(h.api()[0]?.body, { cursor: "c1" });
  assert.deepEqual([r["cursor"], r["hasMore"]], ["c2", false]);
});

test("the web address opens the folder or the file's folder with a preview, names are escaped", () => {
  assert.equal(d.webUrlOf("/Sales", true), "https://www.dropbox.com/home/Sales");
  assert.equal(d.webUrlOf("/Sales/Q4/Deck é.pptx", false), "https://www.dropbox.com/home/Sales/Q4?preview=Deck%20%C3%A9.pptx");
  assert.equal(d.webUrlOf("/Report.docx", false), "https://www.dropbox.com/home?preview=Report.docx");
  assert.equal(d.webUrlOf("", true), "https://www.dropbox.com/home");
  assert.equal(d.webUrlOf("/a/b c", true), "https://www.dropbox.com/home/a/b%20c");
});

test("a deleted path is answered with the id the mount knew it by, and a deleted folder with everything listed inside it", async () => {
  const h = ready();
  rpc(h, "list_folder", { status: 200, body: { entries: [RECORDED.folder, RECORDED.file, RECORDED.sub, RECORDED.deep], cursor: "c1", has_more: false } });
  await d.listFolder(h.ctx, { connectionId: CON, path: "/Sales", recursive: true });
  rpc(h, "list_folder/continue", { status: 200, body: { entries: [{ ".tag": "deleted", name: "Q4", path_lower: "/sales/q4", path_display: "/Sales/Q4" }, { ".tag": "deleted", name: "Report.docx", path_lower: "/sales/report.docx" }, { ".tag": "deleted", name: "x", path_lower: "/never/seen" }], cursor: "c2", has_more: false } });
  const r = out(await d.listFolder(h.ctx, { connectionId: CON, cursor: "c1" }));
  const gone = (r["entries"] as Json[]).map((e) => [e["id"], e["deleted"]]);
  assert.deepEqual(gone.sort(), [["", true], ["id:file1", true], ["id:file2", true], ["id:fold2", true]].sort(), "the folder, its file, and the lone file; a path never seen has no id");
  assert.deepEqual(h.rows(`SELECT "nodeId" FROM dropbox_node`).map((x) => x["nodeId"]), ["id:fold1"], "the index forgets what is gone");
});

test("a rename or move refreshes the index; the old path no longer answers for the id", async () => {
  const h = ready();
  rpc(h, "list_folder", { status: 200, body: { entries: [RECORDED.file], cursor: "c1", has_more: false } });
  await d.listFolder(h.ctx, { connectionId: CON, path: "/Sales" });
  rpc(h, "list_folder/continue", { status: 200, body: { entries: [{ ...RECORDED.file, name: "Final.docx", path_lower: "/sales/final.docx", path_display: "/Sales/Final.docx" }], cursor: "c2", has_more: false } });
  await d.listFolder(h.ctx, { connectionId: CON, cursor: "c1" });
  assert.deepEqual(h.rows(`SELECT "pathLower" FROM dropbox_node`), [{ pathLower: "/sales/final.docx" }]);
  assert.equal(d.idAt(h.ctx, (await import("../projections.ts")).accountOf(h.ctx, CON), "/sales/final.docx"), "id:file1");
});

test("get_metadata takes a path or an id and refuses anything else", async () => {
  const h = ready();
  rpc(h, "get_metadata", { status: 200, body: RECORDED.file });
  const r = out(await d.getMetadata(h.ctx, { connectionId: CON, path: "id:file1" }));
  assert.deepEqual(contractErrors("dropbox.files.get_metadata", "out", r), []);
  assert.equal(out(r["entry"])["webUrl"], "https://www.dropbox.com/home/Sales?preview=Report.docx");
  for (const path of ["", "/", "Sales/Report.docx", "/Sales/", 5]) assert.equal(await refusedWith(d.getMetadata(h.ctx, { connectionId: CON, path })), "validation.bad_input", String(path));
  assert.equal(h.api().length, 1, "a bad path never reaches Dropbox");
});

test("download puts the bytes in a blob with the file's type, or one revision of it", async () => {
  const h = ready();
  h.nextDownload({ status: 200, json: {}, size: 1200 }, { status: 200, json: {}, size: 90 });
  const a = out(await d.download(h.ctx, { connectionId: CON, path: "/Sales/Report.docx" }));
  assert.deepEqual(contractErrors("dropbox.files.download", "out", a), []);
  assert.deepEqual([a["size"], a["mime"]], [1200, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  assert.deepEqual(h.downloads[0]?.arg, { path: "/Sales/Report.docx" });
  await d.download(h.ctx, { connectionId: CON, path: "/Sales/Report.docx", rev: "015ab0c1d2e3f4a5" });
  assert.deepEqual(h.downloads[1]?.arg, { path: "rev:015ab0c1d2e3f4a5" });
  h.nextDownload({ status: 409, json: { error_summary: "path/not_found/.." } });
  assert.equal(await refusedWith(d.download(h.ctx, { connectionId: CON, path: "/gone" })), "validation.not_found");
});

test("a 401 gets one retry with a fresh token, on JSON calls and on transfers", async () => {
  const h = ready();
  rpc(h, "get_metadata", { status: 401, body: { error_summary: "expired_access_token/" } }, { status: 200, body: RECORDED.file });
  await d.getMetadata(h.ctx, { connectionId: CON, path: "/Sales/Report.docx" });
  assert.deepEqual(h.api().map((r) => r.headers["authorization"]), ["Bearer tok-1", "Bearer tok-2"]);
  assert.equal(h.tokenAsks[1]?.fresh, true);
  rpc(h, "get_metadata", { status: 401, body: {} });
  assert.equal(await refusedWith(d.getMetadata(h.ctx, { connectionId: CON, path: "/x" })), "provider.auth_failed", "still refused on the fresh token");
  h.nextDownload({ status: 401, json: {} }, { status: 200, json: {}, size: 5 });
  assert.equal(out(await d.download(h.ctx, { connectionId: CON, path: "/a.pdf" }))["size"], 5);
  assert.equal(h.downloads[1]?.token !== h.downloads[0]?.token, true);
});

test("upload without a revision adds the file and keeps both when the name is taken; with a revision it only replaces that revision", async () => {
  const h = ready();
  const add = out(await d.upload(h.ctx, { connectionId: CON, fileId: "fil_abc1", path: "/Sales/Report.docx" }));
  assert.deepEqual(contractErrors("dropbox.files.upload", "out", add), []);
  assert.deepEqual(h.uploads[0]?.arg, { path: "/Sales/Report.docx", mode: "add", autorename: true, mute: true, strict_conflict: false });
  assert.equal(h.uploads[0]?.fileId, "fil_abc1");
  await d.upload(h.ctx, { connectionId: CON, fileId: "fil_abc1", path: "/Sales/Report.docx", rev: "015ab0c1d2e3f4a5" });
  assert.deepEqual(h.uploads[1]?.arg, { path: "/Sales/Report.docx", mode: { ".tag": "update", update: "015ab0c1d2e3f4a5" }, autorename: false, mute: true, strict_conflict: true });
  h.nextUpload({ status: 409, json: { error_summary: "path/conflict/file/.." } });
  assert.equal(await refusedWith(d.upload(h.ctx, { connectionId: CON, fileId: "fil_abc1", path: "/Sales/Report.docx", rev: "old" })), "validation.version_conflict", "the file moved on: never an overwrite");
  assert.equal(await refusedWith(d.upload(h.ctx, { connectionId: CON, fileId: "fil_abc1", path: "id:file1" })), "validation.bad_input", "an upload names a place, not an id");
  assert.equal(await refusedWith(d.upload(h.ctx, { connectionId: CON, path: "/a" })), "validation.bad_input");
  assert.equal(h.rows(`SELECT * FROM dropbox_node`).length, 1, "the uploaded file is in the index");
});

test("create_folder, delete and restore", async () => {
  const h = ready();
  rpc(h, "create_folder_v2", { status: 200, body: { metadata: { name: "Q4", path_lower: "/sales/q4", path_display: "/Sales/Q4", id: "id:fold2" } } });
  const f = out(await d.createFolder(h.ctx, { connectionId: CON, path: "/Sales/Q4" }));
  assert.deepEqual(contractErrors("dropbox.files.create_folder", "out", f), []);
  assert.equal(out(f["entry"])["isFolder"], true);
  assert.deepEqual(h.api()[0]?.body, { path: "/Sales/Q4", autorename: false });
  rpc(h, "delete_v2", { status: 200, body: { metadata: { ".tag": "folder", name: "Q4", path_lower: "/sales/q4", id: "id:fold2" } } });
  assert.deepEqual(out(await d.deleteItem(h.ctx, { connectionId: CON, path: "/Sales/Q4", rev: "r1" })), { deleted: true });
  assert.deepEqual(h.api()[1]?.body, { path: "/Sales/Q4", parent_rev: "r1" });
  assert.equal(h.rows(`SELECT * FROM dropbox_node`).length, 0, "the deleted folder leaves the index");
  rpc(h, "restore", { status: 200, body: RECORDED.file });
  const r = out(await d.restore(h.ctx, { connectionId: CON, path: "/Sales/Report.docx", rev: "015ab0c1d2e3f4a5" }));
  assert.deepEqual(contractErrors("dropbox.files.restore", "out", r), []);
  assert.deepEqual(h.api()[2]?.body, { path: "/Sales/Report.docx", rev: "015ab0c1d2e3f4a5" });
  assert.equal(await refusedWith(d.restore(h.ctx, { connectionId: CON, path: "/a" })), "validation.bad_input");
});

test("list_revisions returns the revisions newest first, and whether the file is deleted", async () => {
  const h = ready();
  rpc(h, "list_revisions", { status: 200, body: { is_deleted: false, entries: [{ ...RECORDED.file, rev: "015ab0c1d2e3f4a5" }, { ...RECORDED.file, rev: "015ab0c1d2e3f400", server_modified: "2026-10-01T10:00:00Z" }] } });
  const r = out(await d.listRevisions(h.ctx, { connectionId: CON, path: "/Sales/Report.docx", limit: 5 }));
  assert.deepEqual(contractErrors("dropbox.files.list_revisions", "out", r), []);
  assert.deepEqual((r["revisions"] as Json[]).map((x) => x["rev"]), ["015ab0c1d2e3f4a5", "015ab0c1d2e3f400"]);
  assert.deepEqual(h.api()[0]?.body, { path: "/Sales/Report.docx", mode: "path", limit: 5 });
});

test("latest_cursor starts a change feed and longpoll waits on it without a token", async () => {
  const h = ready();
  rpc(h, "list_folder/get_latest_cursor", { status: 200, body: { cursor: "start1" } });
  assert.deepEqual(out(await d.latestCursor(h.ctx, { connectionId: CON, path: "/Sales" })), { cursor: "start1" });
  assert.deepEqual(h.api()[0]?.body, { path: "/Sales", recursive: true, include_deleted: false });
  h.on("POST notify.dropboxapi.com/2/files/list_folder/longpoll", { status: 200, body: { changes: true, backoff: 60 } });
  const w = out(await d.longpoll(h.ctx, { connectionId: CON, cursor: "start1", timeoutSeconds: 90 }));
  assert.deepEqual(contractErrors("dropbox.files.longpoll", "out", w), []);
  assert.deepEqual(w, { changes: true, backoffSeconds: 60 });
  const req = h.api()[1]!;
  assert.deepEqual(req.body, { cursor: "start1", timeout: 90 });
  assert.equal(req.headers["authorization"], undefined, "the notify endpoint takes no token");
  h.on("POST notify.dropboxapi.com/2/files/list_folder/longpoll", { status: 200, body: { changes: false } });
  assert.deepEqual(out(await d.longpoll(h.ctx, { connectionId: CON, cursor: "start1", timeoutSeconds: 5 })), { changes: false });
  assert.equal(h.api()[2]?.body && (h.api()[2]?.body as Json)["timeout"], 30, "the timeout is held to Dropbox's range");
});

test("a reset cursor is told apart so the caller reads the folder from the start", async () => {
  const h = ready();
  rpc(h, "list_folder/continue", { status: 409, body: { error_summary: "reset/.." } });
  let caught: unknown;
  try { await d.listFolder(h.ctx, { connectionId: CON, cursor: "stale" }); } catch (e) { caught = e; }
  assert.equal(d.isCursorReset(caught), true);
  assert.equal((caught as { error: { code: string } }).error.code, "validation.precondition_failed");
});

test("Dropbox's refusals map to the catalogue and its own words are not passed on", async () => {
  const h = ready();
  const cases: [number, unknown, string][] = [
    [409, { error_summary: "path/not_found/.." }, "validation.not_found"],
    [409, { error_summary: "path_lookup/not_found/secret-client-name.docx" }, "validation.not_found"],
    [409, { error_summary: "path/conflict/file/.." }, "validation.version_conflict"],
    [409, { error_summary: "path/insufficient_space/.." }, "validation.too_large"],
    [409, { error_summary: "something_else/.." }, "validation.bad_input"],
    [400, { error_summary: "x" }, "validation.bad_input"],
    [403, { error_summary: "missing_scope/.." }, "provider.auth_failed"],
    [429, { error: { retry_after: 3 } }, "provider.rate_limited"],
    [503, {}, "provider.unavailable"],
    [418, {}, "provider.bad_response"],
  ];
  for (const [status, body, code] of cases) {
    rpc(h, "get_metadata", { status, body });
    let caught: unknown;
    try { await d.getMetadata(h.ctx, { connectionId: CON, path: "/x" }); } catch (e) { caught = e; }
    assert.equal((caught as { error: { code: string } }).error.code, code, `${status} ${JSON.stringify(body)}`);
    assert.ok(!JSON.stringify(caught).includes("secret-client-name"), "a file name Dropbox echoed is not passed on");
  }
  rpc(h, "get_metadata", { throws: true });
  assert.equal(await refusedWith(d.getMetadata(h.ctx, { connectionId: CON, path: "/x" })), "provider.network");
});

test("a connection that does not exist, and a server with no host half, refuse", async () => {
  const h = ready();
  assert.equal(await refusedWith(d.getMetadata(h.ctx, { connectionId: "con_nothere", path: "/x" })), "validation.not_found");
  const none = harness({ noHost: true });
  none.connect();
  assert.equal(await refusedWith(d.getMetadata(none.ctx, { connectionId: CON, path: "/x" })), "internal.unavailable");
});
