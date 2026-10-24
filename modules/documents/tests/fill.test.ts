// documents: fill a Word template with values, deterministically (spec 2.16, 2.12). The formatting of the template survives, a missing value stops the fill and names itself,
// dates and money come from the tag name, records feed tags through a mapping, and the template list follows the marks.
// @reads /modules/documents/migrations/0001_documents.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { configureDocuments, fill, kindOf, placeholders } from "../handlers/fill.ts";
import { docx, para, partNames, partOf, textOf, world, FOLDER, OTHER_FOLDER } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

async function expectCode(code: string, run: () => Promise<unknown>): Promise<VyreErr> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return e;
  }
  return assert.fail(`expected ${code}`);
}

const LETTER = (): Buffer => docx(para("Dear {client.name},") + para("Your fee is {matter.fee} for {matter.title}.") + para("Signed: {cli", "ent.name}"));
const NAMES = { client: { name: "Dana Harlow" }, matter: { fee: 1500, title: "Estate plan" } };

function bytesOf(w: World, fileId: string): Buffer {
  const f = w.files.get(fileId);
  assert.ok(f, `file ${fileId}`);
  return f.bytes;
}

async function filled(w: World, template: string, input: Record<string, unknown> = {}): Promise<{ fileId: string; name: string; versionId: string; bytes: Buffer }> {
  const out = await handlers["documents.fill"](w.ctx, { templateFileId: template, intoFolderId: FOLDER, ...input });
  return { ...out.file, bytes: bytesOf(w, out.file.fileId) };
}

test("fill keeps the formatting of the template: run properties, paragraph properties, a tag split across runs, and every other part", async () => {
  const w = world();
  const body =
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t xml:space="preserve">Dear {client.name},</w:t></w:r></w:p>`
    + `<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>{cli</w:t></w:r><w:r><w:t>ent.name}</w:t></w:r></w:p>`;
  const styles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Heading1"/></w:styles>`;
  const template = docx(body, { "word/styles.xml": styles });
  const id = w.add("Letter.docx", template);
  const out = await filled(w, id, { values: { client: { name: "Dana Harlow" } } });
  assert.deepEqual(textOf(out.bytes), ["Dear Dana Harlow,", "Dana Harlow"]);
  const xml = partOf(out.bytes, "word/document.xml") ?? "";
  assert.ok(xml.includes('<w:jc w:val="center"/>'), "paragraph properties kept");
  assert.ok(xml.includes("<w:rPr><w:b/><w:i/></w:rPr>"), "bold and italic kept");
  assert.ok(xml.includes('<w:color w:val="FF0000"/>'), "the colour of the first run of a split tag kept");
  assert.equal(partOf(out.bytes, "word/styles.xml"), styles, "parts that hold no tag are byte for byte the template's");
  assert.deepEqual(partNames(out.bytes), partNames(template), "no part added or lost");
  assert.deepEqual(textOf(bytesOf(w, id)), ["Dear {client.name},", "{client.name}"], "the template itself is untouched");
});

test("a missing value stops the fill, names every missing field, makes no file and no event", async () => {
  const w = world();
  const id = w.add("Letter.docx", LETTER());
  const before = w.files.size;
  const e = await expectCode("validation.precondition_failed", () => handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: { client: { name: "Dana" }, matter: { title: "Estate plan" } } }));
  assert.deepEqual(e.error.details, { missing: ["matter.fee"] });
  assert.match(e.error.message, /this value is missing: matter\.fee/);
  assert.equal(w.files.size, before, "no document made");
  assert.equal(w.events.length, 0);

  const several = await expectCode("validation.precondition_failed", () => handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: { client: { name: "" } } }));
  assert.deepEqual(several.error.details, { missing: ["client.name", "matter.fee", "matter.title"] }, "an empty string is missing, sorted");
  const zero = fill(docx(para("{a} and {b}")), { a: 0, b: false });
  assert.deepEqual(textOf(zero.buffer), ["0 and false"], "zero and false are values");
});

test("a fill makes a new file in the folder, a first version, an event, and leaves the template alone", async () => {
  const w = world();
  const id = w.add("Letter.docx", LETTER());
  const templateBytes = Buffer.from(bytesOf(w, id));
  const out = await handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: OTHER_FOLDER, values: NAMES });
  assert.equal(out.file.name, "Letter (filled).docx");
  assert.match(out.file.versionId, /^ver_fil_\d+_1$/);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.unused, []);
  assert.deepEqual(textOf(bytesOf(w, out.file.fileId)), ["Dear Dana Harlow,", "Your fee is $1,500.00 for Estate plan.", "Signed: Dana Harlow"]);
  assert.ok(bytesOf(w, id).equals(templateBytes));
  assert.equal(w.files.get(out.file.fileId)?.folderId, OTHER_FOLDER);
  assert.deepEqual(w.events.map((e) => [e.name, e.subject, e.payload]), [["document.filled", `file/${out.file.fileId}`, { fileId: out.file.fileId, templateFileId: id, fields: 3, missing: 0 }]]);
});

test("the same template and values give the same bytes", async () => {
  const t = LETTER();
  const before = Buffer.from(t);
  const a = fill(t, NAMES).buffer;
  const b = fill(t, NAMES).buffer;
  assert.ok(a.equals(b), "deterministic");
  assert.ok(t.equals(before), "the template buffer is untouched");
});

test("names collide politely, a given name keeps its own spelling, and an existing file is never replaced", async () => {
  const w = world();
  const id = w.add("Letter.docx", LETTER());
  const one = await filled(w, id, { values: NAMES });
  const two = await filled(w, id, { values: NAMES });
  const three = await filled(w, id, { values: NAMES });
  assert.deepEqual([one.name, two.name, three.name], ["Letter (filled).docx", "Letter (filled) 2.docx", "Letter (filled) 3.docx"]);
  assert.equal((await filled(w, id, { values: NAMES, name: "Deed for Ruiz" })).name, "Deed for Ruiz.docx");
  assert.equal((await filled(w, id, { values: NAMES, name: "Deed.docx" })).name, "Deed.docx");
});

test("dates and money follow the tag name; the signing date sets its parts; an impossible date is refused", async () => {
  const w = world();
  const body = para("Signed {signing_date} ({signing_day_ordinal} day of {signing_month}, {signing_year})") + para("Fee {matter.fee}") + para("Paid {paid_date}") + para("Iso {signing_date_iso}") + para("Ref {ref}");
  const id = w.add("Deed.docx", docx(body));
  const out = await filled(w, id, { signingDate: "2026-10-24", values: { matter: { fee: 1234.5 }, paid_date: "2026-03-09", ref: "A-1" } });
  assert.deepEqual(textOf(out.bytes), ["Signed October 24, 2026 (24th day of October, 2026)", "Fee $1,234.50", "Paid March 9, 2026", "Iso 2026-10-24", "Ref A-1"]);
  const other = await filled(w, id, { signingDate: "2026-11-02", values: { matter: { fee: 0 }, paid_date: "not a date", ref: "B" }, name: "second" });
  assert.deepEqual(textOf(other.bytes).slice(0, 3), ["Signed November 2, 2026 (2nd day of November, 2026)", "Fee $0.00", "Paid not a date"]);
  const explicit = await filled(w, id, { signingDate: "2026-10-24", values: { signing_year: "MMXXVI", matter: { fee: 1 }, paid_date: "2026-01-01", ref: "x" }, name: "third" });
  assert.match(textOf(explicit.bytes)[0] ?? "", /, MMXXVI\)$/, "a value the caller gave wins over the derived one");
  const e = await expectCode("validation.bad_input", () => handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, signingDate: "2026-02-30" }));
  assert.deepEqual(e.error.details, { field: "signingDate" });
  assert.deepEqual([kindOf("signing_date"), kindOf("client.birth_date"), kindOf("matter.fee"), kindOf("retainer"), kindOf("client.name"), kindOf("update")], ["date", "date", "money", "money", "text", "text"]);
});

test("loops repeat, a list that is missing is named, and sections without tags are conditions that read false when absent", async () => {
  const w = world();
  const body = para("{#items}{label}: {amount}; {/items}done") + para("Status: {^deceased}Alive{/deceased}") + para("Flag: {#flag}Flagged{/flag}");
  const id = w.add("Fees.docx", docx(body));
  const items = [{ label: "filing", amount: 100 }, { label: "retainer", amount: 2500 }];
  const both = await filled(w, id, { values: { items, deceased: false, flag: true } });
  assert.deepEqual(textOf(both.bytes), ["filing: $100.00; retainer: $2,500.00; done", "Status: Alive", "Flag: Flagged"]);
  const bare = await filled(w, id, { values: { items }, name: "bare" });
  assert.deepEqual(textOf(bare.bytes), ["filing: $100.00; retainer: $2,500.00; done", "Status: Alive", "Flag: "], "an absent condition reads false");
  const e = await expectCode("validation.precondition_failed", () => handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: { flag: true } }));
  assert.deepEqual(e.error.details, { missing: ["items"] }, "a loop with no list is missing, not silently empty");
  const info = placeholders(docx(body));
  assert.deepEqual(info.loops, ["items"]);
  assert.deepEqual([...info.conditions].sort(), ["deceased", "flag"]);
  assert.deepEqual(info.loopFields, { items: ["label", "amount"] });
});

test("documents.fields lists the tags with their kinds, loops with their fields, and conditions that are not required", async () => {
  const w = world();
  const body = para("Client {client.name}, signed {signing_date}") + para("Fee {matter.fee}") + para("{#items}{label}: {amount}; {/items}") + para("{^deceased}Alive{/deceased}{#flag}Flagged{/flag}");
  const id = w.add("Mixed.docx", docx(body));
  const out = await handlers["documents.fields"](w.ctx, { templateFileId: id });
  const byName = (name: string, loop?: string) => out.fields.find((f) => f.name === name && f.loop === loop);
  assert.deepEqual(byName("client.name"), { name: "client.name", kind: "text", required: true });
  assert.deepEqual(byName("signing_date"), { name: "signing_date", kind: "date", required: true });
  assert.deepEqual(byName("matter.fee"), { name: "matter.fee", kind: "money", required: true });
  assert.deepEqual(byName("items"), { name: "items", kind: "loop", required: true });
  assert.deepEqual(byName("label", "items"), { name: "label", kind: "text", required: true, loop: "items" });
  assert.deepEqual(byName("amount", "items"), { name: "amount", kind: "money", required: true, loop: "items" });
  assert.deepEqual(byName("deceased"), { name: "deceased", kind: "condition", required: false });
  assert.deepEqual(byName("flag"), { name: "flag", kind: "condition", required: false });
  assert.deepEqual(out.loops, ["items"]);
  assert.deepEqual(out.problems, []);

  const broken = w.add("Broken.docx", docx(para("Hello {client.name")));
  const bad = await handlers["documents.fields"](w.ctx, { templateFileId: broken });
  assert.deepEqual(bad.fields, []);
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0]?.message ?? "", /placeholder that cannot be read/);
  await expectCode("validation.precondition_failed", () => handlers["documents.fill"](w.ctx, { templateFileId: broken, intoFolderId: FOLDER, values: {} }));
});

test("preview shows the filled text with every filled value marked, and what is missing or unused", async () => {
  const w = world();
  const id = w.add("Welcome.docx", docx(para("Dear {client.name}, welcome to {firm}") + para("Static line")));
  const full = await handlers["documents.preview_fill"](w.ctx, { templateFileId: id, values: { client: { name: "Dana" }, firm: "Acme & Co", extra: "x" } });
  assert.deepEqual(full.excerpt, [
    { text: "Dear Dana, welcome to Acme & Co", filled: [{ from: 5, to: 9, field: "client.name" }, { from: 22, to: 31, field: "firm" }] },
    { text: "Static line", filled: [] },
  ]);
  assert.deepEqual(full.missing, []);
  assert.deepEqual(full.unused, ["extra"]);
  const gap = await handlers["documents.preview_fill"](w.ctx, { templateFileId: id, values: { client: { name: "Dana" } } });
  assert.deepEqual(gap.missing, ["firm"]);
  assert.equal(gap.excerpt[0]?.text, "Dear Dana, welcome to ", "a missing value shows as nothing and is listed, never invented");
  assert.equal(w.files.size, 1, "a preview makes no file");
  assert.equal(w.events.length, 0);
});

test("a record feeds the tags through a mapping; explicit values win; without a mapping a field feeds the tag of the same name", async () => {
  const w = world();
  w.records.set("rec_1", { full_name: "Dana Harlow", retainer: 2500, city: "Austin", firm: "Acme" });
  const id = w.add("Letter.docx", docx(para("Dear {client.name},") + para("Fee {matter.fee} for {matter.title}.") + para("{firm}")));
  const out = await filled(w, id, { recordId: "rec_1", mapping: { "client.name": "full_name", "matter.fee": "retainer" }, values: { matter: { title: "Estate plan" }, firm: "Acme" } });
  assert.deepEqual(textOf(out.bytes), ["Dear Dana Harlow,", "Fee $2,500.00 for Estate plan.", "Acme"]);
  assert.deepEqual(w.calls.filter((c) => c.cap === "records.get").map((c) => c.input), [{ recordId: "rec_1" }]);
  assert.deepEqual((w.events.at(-1)?.payload as { recordId?: string }).recordId, "rec_1");

  const typed = await filled(w, id, { recordId: "rec_1", mapping: { "client.name": "full_name", "matter.fee": "retainer" }, values: { recordType: "contact", client: { name: "Override" }, matter: { title: "T" } }, name: "typed" });
  assert.equal(textOf(typed.bytes)[0], "Dear Override,", "explicit values win over the record");
  assert.deepEqual(w.calls.filter((c) => c.cap === "records.get").at(-1)?.input, { type: "contact", recordId: "rec_1" });

  const same = w.add("Same.docx", docx(para("{firm} in {city}")));
  assert.deepEqual(textOf((await filled(w, same, { recordId: "rec_1" })).bytes), ["Acme in Austin"]);
  await expectCode("validation.not_found", () => handlers["documents.fill"](w.ctx, { templateFileId: same, intoFolderId: FOLDER, recordId: "rec_none" }));
});

test("a file that is not a Word document, a template that is too big and a template the caller may not open are refused", async () => {
  const w = world();
  const text = w.add("notes.docx", Buffer.from("hello"));
  await expectCode("validation.unsupported", () => handlers["documents.fill"](w.ctx, { templateFileId: text, intoFolderId: FOLDER, values: {} }));
  await expectCode("validation.unsupported", () => handlers["documents.fields"](w.ctx, { templateFileId: text }));
  const big = w.add("big.docx", Buffer.alloc(11 * 1024 * 1024, 1));
  await expectCode("validation.too_large", () => handlers["documents.fill"](w.ctx, { templateFileId: big, intoFolderId: FOLDER, values: {} }));
  const id = w.add("Letter.docx", LETTER());
  const closed: Ctx = { ...w.ctx, authorize: () => ({ effect: "deny", reason: "no grant", decisionId: "dec_no" }) };
  await expectCode("permission.no_grant", () => handlers["documents.fill"](closed, { templateFileId: id, intoFolderId: FOLDER, values: NAMES }));
  await expectCode("permission.no_grant", () => handlers["documents.preview_fill"](closed, { templateFileId: id, values: NAMES }));
  w.denied.add(id);
  await expectCode("validation.not_found", () => handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: NAMES }));
  await expectCode("validation.bad_input", () => handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, format: "rtf" }));
});

test("PDF goes through the converter the host gave; without one it is refused in plain words and no file is made", async () => {
  const w = world();
  const id = w.add("Letter.docx", LETTER());
  configureDocuments(null);
  const e = await expectCode("validation.unsupported", () => handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: NAMES, format: "pdf" }));
  assert.match(e.error.message, /PDF needs a converter/);
  assert.equal(w.files.size, 1);
  let sawDocx = 0;
  configureDocuments({
    pdf: async (docxBytes) => {
      sawDocx = textOf(docxBytes).length;
      return Buffer.from("%PDF-1.7 converted");
    },
  });
  try {
    const out = await handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: NAMES, format: "pdf" });
    assert.equal(out.file.name, "Letter (filled).pdf");
    assert.equal(sawDocx, 3, "the converter got the filled Word file");
    const stored = w.files.get(out.file.fileId);
    assert.equal(stored?.mime, "application/pdf");
    assert.equal(stored?.bytes.subarray(0, 5).toString(), "%PDF-");
  } finally {
    configureDocuments(null);
  }
});

test("marking a template, listing templates, folder filter, access, paging and unmarking", async () => {
  const w = world();
  const a = w.add("Alpha.docx", LETTER());
  const b = w.add("Beta.docx", docx(para("{x}")), OTHER_FOLDER);
  const c = w.add("Gamma.docx", LETTER());
  const notes = w.add("notes.txt", Buffer.from("hi"));
  for (const id of [c, a, b]) assert.deepEqual(await handlers["documents.mark_template"](w.ctx, { fileId: id, isTemplate: true }), { ok: true });
  assert.equal(w.marks().length, 3);
  assert.deepEqual(w.events.map((e) => e.name), ["document.template_marked", "document.template_marked", "document.template_marked"]);
  await handlers["documents.mark_template"](w.ctx, { fileId: a, isTemplate: true });
  assert.equal(w.events.length, 3, "marking twice is quiet");
  await expectCode("validation.unsupported", () => handlers["documents.mark_template"](w.ctx, { fileId: notes, isTemplate: true }));
  assert.deepEqual(await handlers["documents.mark_template"](w.ctx, { fileId: notes, isTemplate: false }), { ok: true });

  const all = await handlers["documents.templates.list"](w.ctx, {});
  assert.deepEqual(all.templates.map((t) => [t.name, t.folderId, t.fields]), [["Alpha.docx", FOLDER, 3], ["Beta.docx", OTHER_FOLDER, 1], ["Gamma.docx", FOLDER, 3]]);
  assert.equal(all.total, 3);
  assert.deepEqual((await handlers["documents.templates.list"](w.ctx, { folder: OTHER_FOLDER })).templates.map((t) => t.name), ["Beta.docx"]);
  const page = await handlers["documents.templates.list"](w.ctx, { limit: 2 });
  assert.deepEqual([page.templates.length, page.next, page.total], [2, "2", 3]);
  assert.deepEqual((await handlers["documents.templates.list"](w.ctx, { limit: 2, cursor: page.next })).templates.map((t) => t.name), ["Gamma.docx"]);

  w.denied.add(b);
  assert.deepEqual((await handlers["documents.templates.list"](w.ctx, {})).templates.map((t) => t.name), ["Alpha.docx", "Gamma.docx"], "a template the caller cannot open is not listed");
  w.denied.delete(b);
  assert.deepEqual(await handlers["documents.mark_template"](w.ctx, { fileId: c, isTemplate: false }), { ok: true });
  assert.deepEqual((await handlers["documents.templates.list"](w.ctx, {})).templates.map((t) => t.name), ["Alpha.docx", "Beta.docx"]);
  assert.equal(w.events.at(-1)?.name, "document.template_marked");
  assert.deepEqual(w.events.at(-1)?.payload, { fileId: c, isTemplate: false });
  await expectCode("validation.bad_input", () => handlers["documents.templates.list"](w.ctx, { limit: 0 }));
  assert.equal((await handlers["documents.templates.list"](w.ctx, { limit: 1, cursor: "x" })).templates[0]?.name, "Alpha.docx", "a cursor that is not a number starts again from the top");
});
