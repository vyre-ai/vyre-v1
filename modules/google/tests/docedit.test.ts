// @reads /modules/google/handlers/docedit.ts
// Editing a Google Doc by the words in it (live folders L3): replace some text, or insert after or before an anchor, at the start or at the end, against the revision that was read.
// Replayed against recorded Docs answers; no socket is opened.
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/google.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { registry } from "../../../generated/registry.ts";
import { docInsert, docReplace } from "../handlers/index.ts";
import { flatten } from "../handlers/docedit.ts";
import { act, codeOf, harness, seedDelegation } from "../fixtures/harness.ts";

const DOCS = "https://docs.googleapis.com/v1/documents";
const CAP = (name: string) => manifest.capabilities?.find((c) => c.name === name);
const conforms = (cap: string, side: "input" | "output", value: unknown): string[] => validate((CAP(cap) as NonNullable<ReturnType<typeof CAP>>)[side], value, "", registry.$defs);

// "Dear Client Name,\n" (1-19), "Total: " + "$100" + "\n" (19-31), a picture at 31, then a table cell "Cell text\n" (33-43)
const DOC = {
  title: "Engagement letter", revisionId: "rev-7",
  body: { content: [
    { endIndex: 1, sectionBreak: {} },
    { startIndex: 1, endIndex: 19, paragraph: { elements: [{ startIndex: 1, endIndex: 19, textRun: { content: "Dear Client Name,\n" } }] } },
    { startIndex: 19, endIndex: 32, paragraph: { elements: [
      { startIndex: 19, endIndex: 26, textRun: { content: "Total: " } }, { startIndex: 26, endIndex: 30, textRun: { content: "$100", textStyle: { bold: true } } }, { startIndex: 30, endIndex: 31, inlineObjectElement: {} }, { startIndex: 31, endIndex: 32, textRun: { content: "\n" } },
    ] } },
    { startIndex: 32, endIndex: 44, table: { tableRows: [{ tableCells: [{ content: [{ startIndex: 33, endIndex: 43, paragraph: { elements: [{ startIndex: 33, endIndex: 43, textRun: { content: "Cell text\n" } }] } }] }] }] } },
    { startIndex: 44, endIndex: 45, paragraph: { elements: [{ startIndex: 44, endIndex: 45, textRun: { content: "\n" } }] } },
  ] },
};

function ready() {
  const h = harness();
  seedDelegation(h);
  h.on("GET", `${DOCS}/d1`, { body: DOC });
  h.on("POST", `${DOCS}/d1:batchUpdate`, { body: { replies: [{}] } });
  return h;
}
const sent = (h: ReturnType<typeof ready>) => h.hits(`${DOCS}/d1:batchUpdate`, "POST").at(-1)!.body as { requests: Record<string, unknown>[]; writeControl?: unknown };

test("flatten gives every character its document index, reads table cells, and breaks the text at a picture", () => {
  const f = flatten(DOC.body.content);
  assert.equal(f.full, "Dear Client Name,\nTotal: $100\u0000\n\u0000Cell text\n\u0000\n");
  assert.equal(f.indexAt[0], 1);
  assert.equal(f.indexAt[f.full.indexOf("$100")], 26);
  assert.equal(f.indexAt[f.full.indexOf("Cell")], 33);
  assert.equal(f.endIndex, 45);
});

test("replace_text sends one replaceAllText and says how many places changed", async () => {
  const h = ready();
  h.on("POST", `${DOCS}/d1:batchUpdate`, { body: { replies: [{ replaceAllText: { occurrencesChanged: 3 } }] } });
  const out = await docReplace(h.ctx, { ...act, documentId: "d1", find: "Client Name", replace: "Dana Wine" });
  assert.deepEqual(out, { replaced: 3 });
  assert.deepEqual(conforms("google.docs.replace_text", "output", out), []);
  assert.deepEqual(sent(h).requests, [{ replaceAllText: { containsText: { text: "Client Name", matchCase: false }, replaceText: "Dana Wine" } }]);
  await docReplace(h.ctx, { ...act, documentId: "d1", find: "Client", replace: "X", matchCase: true });
  assert.equal(((sent(h).requests[0]!["replaceAllText"] as Record<string, unknown>)["containsText"] as Record<string, unknown>)["matchCase"], true);
  h.on("POST", `${DOCS}/d1:batchUpdate`, { body: { replies: [{ replaceAllText: {} }] } });
  assert.deepEqual(await docReplace(h.ctx, { ...act, documentId: "d1", find: "nothing", replace: "x" }), { replaced: 0 }, "no match is zero, not an error");
  await assert.rejects(docReplace(h.ctx, { ...act, documentId: "d1", find: "", replace: "x" }), (e: unknown) => codeOf(e) === "validation.bad_input");
});

test("insert_text puts the words after or before an anchor, at the start, or at the end, and ties the write to the revision it read", async () => {
  const h = ready();
  const cases: [Parameters<typeof docInsert>[1], number][] = [
    [{ ...act, documentId: "d1", text: " (net 30)", anchor: "Total: $100" }, 30],
    [{ ...act, documentId: "d1", text: "Re: ", where: "before", anchor: "Total" }, 19],
    [{ ...act, documentId: "d1", text: "Hello", where: "start" }, 1],
    [{ ...act, documentId: "d1", text: "Signed.", where: "end" }, 44],
    [{ ...act, documentId: "d1", text: "!", where: "after", anchor: "Cell text" }, 42],
    [{ ...act, documentId: "d1", text: "Dr. ", where: "before", anchor: "client name", matchCase: false }, 6],
  ];
  for (const [input, index] of cases) {
    const out = await docInsert(h.ctx, input);
    assert.deepEqual(out, { inserted: true, index }, JSON.stringify(input));
    assert.deepEqual(conforms("google.docs.insert_text", "output", out), []);
    assert.deepEqual(sent(h).requests, [{ insertText: { location: { index }, text: input.text } }]);
    assert.deepEqual(sent(h).writeControl, { requiredRevisionId: "rev-7" });
  }
});

test("an anchor that is not there, or that spans a picture, or no anchor where one is needed, is refused before anything is written", async () => {
  const h = ready();
  const writes = (): number => h.hits(`${DOCS}/d1:batchUpdate`, "POST").length;
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "x", anchor: "Nobody" }), (e: unknown) => codeOf(e) === "validation.not_found");
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "x", anchor: "$100\n" }), (e: unknown) => codeOf(e) === "validation.not_found", "text either side of a picture is not one string");
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "x", anchor: "client name" }), (e: unknown) => codeOf(e) === "validation.not_found", "case matters unless matchCase is false");
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "x", where: "after" }), (e: unknown) => codeOf(e) === "validation.bad_input");
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "" }), (e: unknown) => codeOf(e) === "validation.bad_input");
  assert.equal(writes(), 0);
});

test("a document that changed since it was read answers a version conflict, not a write in the wrong place", async () => {
  const h = ready();
  h.on("POST", `${DOCS}/d1:batchUpdate`, { status: 400, body: { error: { status: "FAILED_PRECONDITION", message: "Precondition check failed." } } });
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "x", where: "start" }), (e: unknown) => codeOf(e) === "validation.version_conflict");
  h.on("POST", `${DOCS}/d1:batchUpdate`, { status: 403, body: {} });
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "x", where: "start" }), (e: unknown) => codeOf(e) === "permission.no_grant", "a refusal that is not about the revision stays what it is");
  h.on("POST", `${DOCS}/d1:batchUpdate`, { status: 412, body: {} });
  await assert.rejects(docInsert(h.ctx, { ...act, documentId: "d1", text: "x", where: "start" }), (e: unknown) => codeOf(e) === "validation.version_conflict");
});

test("the new capabilities are in the manifest behind the same Gate act as batch_update, on the files tools", () => {
  for (const name of ["google.docs.replace_text", "google.docs.insert_text"]) {
    const c = CAP(name);
    assert.equal(c?.gate?.act, CAP("google.docs.batch_update")?.gate?.act);
    assert.equal(c?.surfaces.mcp?.toolset, "files");
    assert.ok((c?.summary.length ?? 999) <= 300);
  }
});

test("the Drive change feed's start token is reachable through the module's own handler map (a mount reads the feed from its first pass)", async () => {
  const { handlers } = await import("../impl.ts");
  const h = harness();
  seedDelegation(h);
  h.on("GET", "https://www.googleapis.com/drive/v3/changes/startPageToken", { body: { startPageToken: "tok-42" } });
  assert.deepEqual(await handlers["google.drive.changes_start_token"]!(h.ctx as never, { ...act } as never), { startPageToken: "tok-42" });
});
