// @reads /modules/files/handlers/tree.ts
// Reading a PDF or an Office file as text (live folders L3): files.read with as text answers the extracted text from the previews module, the way an agent or a person reads the file, instead of the bytes of a
// zip file as if they were words. Offset and length count characters then. Plain text files are read as before.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { open } from "../fixtures/lists-world.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type H = (ctx: Ctx, input: unknown) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (ctx: Ctx, cap: string, input: unknown = {}) => (handlers as unknown as Record<string, H>)[cap]!(ctx, input);

function world(extra: (cap: string, input: Obj) => unknown) {
  let ctx!: Ctx;
  const seen: { cap: string; input: Obj }[] = [];
  const w = open((cap, input) => {
    seen.push({ cap, input: (input ?? {}) as Obj });
    const e = extra(cap, (input ?? {}) as Obj);
    if (e !== undefined) return e;
    const h = (handlers as unknown as Record<string, H>)[cap];
    if (!h) throw new Error(`unscripted call ${cap}`);
    return h(ctx, input);
  });
  ctx = w.ctx;
  return { ...w, seen };
}

async function make(ctx: Ctx, name: string, mime: string | undefined, text: string): Promise<string> {
  const root = (await call(ctx, "files.tree")).roots.find((r: Obj) => r.key === "personal").folderId;
  // an Office file has no text mime: what a mount or an upload leaves is octet-stream
  return (await call(ctx, "files.create", { folderId: root, name, mime: mime ?? "application/octet-stream", content: { text }, idempotencyKey: `k-${name}` })).file.fileId;
}

const BODY = "Engagement letter\nDear Client,\nTotal due: 2026-10-31";

test("as text, a Word, Excel, PowerPoint or PDF file comes back as its extracted text, whatever its mime says", async () => {
  const asked: Obj[] = [];
  const { ctx } = world((cap, input) => {
    if (cap !== "previews.text") return undefined;
    asked.push(input);
    return { text: BODY, pages: 1, truncated: false, source: "office" };
  });
  for (const [name, mime] of [["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["Budget.xlsx", undefined], ["deck.PPTX", "application/octet-stream"], ["scan.pdf", "application/pdf"], ["notes.odt", undefined], ["old.doc", "application/msword"]] as const) {
    const id = await make(ctx, name, mime, "PK-not-really-text");
    const r = await call(ctx, "files.read", { fileId: id, as: "text" });
    assert.equal(r.text, BODY, name);
    assert.equal(r.truncated, false);
    assert.equal(asked.at(-1)?.fileId, id);
  }
});

test("offset and length cut the extracted text by characters, and the answer says it was cut; the previews' own truncation is passed on", async () => {
  const { ctx } = world((cap) => (cap === "previews.text" ? { text: BODY, pages: 1, truncated: false, source: "office" } : undefined));
  const id = await make(ctx, "letter.docx", undefined, "x");
  const part = await call(ctx, "files.read", { fileId: id, as: "text", offset: 18, length: 12 });
  assert.deepEqual([part.text, part.truncated], ["Dear Client,", true]);
  const tail = await call(ctx, "files.read", { fileId: id, as: "text", offset: 30 });
  assert.equal(tail.text, BODY.slice(30));
  const whole = await call(ctx, "files.read", { fileId: id, as: "text", offset: 0, length: 1000 });
  assert.deepEqual([whole.text, whole.truncated], [BODY, false]);
  const cut = world((cap) => (cap === "previews.text" ? { text: "abc", truncated: true, source: "pdf" } : undefined));
  const big = await make(cut.ctx, "big.pdf", "application/pdf", "x");
  assert.equal((await call(cut.ctx, "files.read", { fileId: big, as: "text" })).truncated, true);
});

test("a version can be named; the default and base64 reads of the same file are unchanged, and a text file never asks the previews", async () => {
  const w = world((cap) => (cap === "previews.text" ? { text: "extracted", truncated: false, source: "office" } : undefined));
  const id = await make(w.ctx, "letter.docx", undefined, "PK");
  const file = (await call(w.ctx, "files.get", { fileId: id })).file;
  const v1 = file.version;
  await call(w.ctx, "files.read", { fileId: id, as: "text" });
  assert.equal(w.seen.filter((s) => s.cap === "previews.text").at(-1)?.input["versionId"], undefined);
  const base = await call(w.ctx, "files.read", { fileId: id });
  assert.ok(base.base64 !== undefined && base.text === undefined, "no `as` on a binary file is still base64");
  assert.equal(v1, base.version);
  const md = await make(w.ctx, "note.md", "text/markdown", "# Hi");
  const before = w.seen.filter((s) => s.cap === "previews.text").length;
  assert.equal((await call(w.ctx, "files.read", { fileId: md, as: "text" })).text, "# Hi");
  assert.equal(w.seen.filter((s) => s.cap === "previews.text").length, before, "plain text is read directly");
});

test("when the text cannot be taken out, the read says so and does not hand back the bytes", async () => {
  for (const code of ["provider.unavailable", "validation.unsupported", "internal.unexpected"]) {
    const { ctx } = world((cap) => { if (cap === "previews.text") throw new VyreErr({ code: code as never, message: "no", retryable: false, traceId: "0".repeat(32), next: [] }); return undefined; });
    const id = await make(ctx, "letter.docx", undefined, "PK-binary");
    try { await call(ctx, "files.read", { fileId: id, as: "text" }); assert.fail("expected a refusal"); } catch (e) {
      assert.ok(e instanceof VyreErr);
      assert.equal(e.error.code, "validation.unsupported", code);
      assert.ok(!JSON.stringify(e.error).includes("PK-binary"));
    }
  }
});
