// documents: the Vyre document as a template (lane r42-docs). A Markdown template fills by the same rules as a Word one and comes out as a PDF set in process; {sign:role} places are
// remembered and answered; a blank still in a document stops its PDF; the same input gives the same bytes; a letter the fonts cannot draw is refused, not misprinted.
// @reads /modules/documents/migrations/0003_documents_signing.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { handlers } from "../impl.ts";
import { configureDocuments } from "../handlers/fill.ts";
import { docx, para, world, FOLDER } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

async function expectCode(code: string, run: () => Promise<unknown>): Promise<VyreErr> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? (e.stack ?? "throw") : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return e;
  }
  return assert.fail(`expected ${code}`);
}

const enc = (s: string): Buffer => Buffer.from(s, "utf8");
const AGREEMENT = `# Service agreement

This agreement is between {firm.name} and {client.name}, dated {signing_date}.

## Fee

The fee is {matter.fee}.

{sign:client} || {sign:firm}
`;
const VALUES = { firm: { name: "Northwind" }, client: { name: "Imran Ibarra" }, matter: { fee: 1500 } };

const bytesOf = (w: World, id: string): Buffer => {
  const f = w.files.get(id);
  assert.ok(f, `file ${id}`);
  return f.bytes;
};
const isPdf = (b: Uint8Array): boolean => Buffer.from(b.slice(0, 5)).toString("latin1") === "%PDF-";

test("a Vyre document lists its blanks and the signer roles it names", async () => {
  const w = world();
  const id = w.add("Agreement.md", enc(AGREEMENT));
  const got = await handlers["documents.fields"](w.ctx, { templateFileId: id });
  const names = got.fields.map((f) => f.name);
  assert.ok(names.includes("firm.name") && names.includes("client.name") && names.includes("matter.fee"), names.join());
  assert.deepEqual(got.signers, ["client", "firm"]);
  assert.deepEqual(got.problems, []);
});

test("a Vyre document fills to a PDF with no converter, makes one file, and remembers where each signer signs", async () => {
  const w = world();
  const id = w.add("Agreement.md", enc(AGREEMENT));
  const out = await handlers["documents.fill"](w.ctx, {
    templateFileId: id,
    intoFolderId: FOLDER,
    values: VALUES,
    signingDate: "2026-11-19",
    name: "Agreement - Ibarra",
  });
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.signers, ["client", "firm"]);
  assert.match(out.file.name, /^Agreement - Ibarra\.pdf$/);
  assert.ok(isPdf(bytesOf(w, out.file.fileId)));
  const where = await handlers["documents.signing"](w.ctx, { fileId: out.file.fileId });
  assert.deepEqual(where.signers, ["client", "firm"]);
  assert.equal(where.templateFileId, id);
  const places = where.places as { signer: number; kind: string; page: number; x: number; y: number }[];
  assert.ok(places.filter((p) => p.kind === "signature").length === 2, JSON.stringify(places));
  for (const p of places) {
    assert.ok(p.page >= 1 && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100, JSON.stringify(p));
  }
  // the template is left alone and a PDF of any other file has no places
  assert.equal(bytesOf(w, id).toString("utf8"), AGREEMENT);
  assert.deepEqual(await handlers["documents.signing"](w.ctx, { fileId: id }), {
    signers: [],
    places: [],
    checkedVersion: "1",
  });
});

test("the same template and values give the same PDF bytes", async () => {
  const a = world();
  const b = world();
  const make = async (w: World) => {
    const id = w.add("Agreement.md", enc(AGREEMENT));
    const o = await handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: VALUES,
      signingDate: "2026-11-19",
    });
    return bytesOf(w, o.file.fileId);
  };
  assert.ok((await make(a)).equals(await make(b)));
});

test("a missing value stops the document, names itself, and makes no file and no event", async () => {
  const w = world();
  const id = w.add("Agreement.md", enc(AGREEMENT));
  const before = w.files.size;
  const events = w.events.length;
  const e = await expectCode("validation.precondition_failed", () =>
    handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: { firm: { name: "Northwind" } },
    }),
  );
  assert.match(e.error.message, /client\.name/);
  assert.equal(w.files.size, before);
  assert.equal(w.events.length, events);
});

test("a Vyre document fills to Markdown to go on editing, and Word asks for Word", async () => {
  const w = world();
  const id = w.add("Agreement.md", enc(AGREEMENT));
  const out = await handlers["documents.fill"](w.ctx, {
    templateFileId: id,
    intoFolderId: FOLDER,
    values: VALUES,
    signingDate: "2026-11-19",
    format: "md",
  });
  const text = bytesOf(w, out.file.fileId).toString("utf8");
  assert.match(text, /Northwind and Imran Ibarra/);
  assert.doesNotMatch(text, /\{client\.name\}/);
  await expectCode("validation.bad_input", () =>
    handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: VALUES, format: "rtf" }),
  );
  await expectCode("validation.unsupported", () =>
    handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: VALUES, format: "docx" }),
  );
});

test("an agent's first make_pdf call on a plain .md works: a file and a folder is all it needs, no tags, no key, no name", async () => {
  const w = world();
  const plain = w.add("Memo.md", enc("# Memo\n\nThe office is closed on Friday.\n"));
  const out = await handlers["documents.make_pdf"](w.ctx, { fileId: plain, intoFolderId: FOLDER });
  assert.ok(isPdf(bytesOf(w, out.file.fileId)), "a real PDF");
  assert.equal(out.file.name, "Memo.pdf");
  assert.ok(out.pages >= 1);
  assert.deepEqual(out.signers ?? [], [], "no roles, none claimed");
});

test("a PDF of a finished document is made beside it; a blank still in the text stops it and is named", async () => {
  const w = world();
  const done = w.add("Letter.md", enc("# Letter\n\nDear Imran,\n\nWelcome.\n\n{sign:client}\n"));
  const out = await handlers["documents.make_pdf"](w.ctx, { fileId: done, intoFolderId: FOLDER });
  assert.ok(isPdf(bytesOf(w, out.file.fileId)));
  assert.ok(out.pages >= 1);
  assert.deepEqual(out.signers, ["client"]);
  const open = w.add("Draft.md", enc("Dear {client.name},\n"));
  const e = await expectCode("validation.precondition_failed", () =>
    handlers["documents.make_pdf"](w.ctx, { fileId: open, intoFolderId: FOLDER }),
  );
  assert.match(e.error.message, /client\.name/);
  const word = w.add("Plain.txt", enc("hello"));
  await expectCode("validation.unsupported", () =>
    handlers["documents.make_pdf"](w.ctx, { fileId: word, intoFolderId: FOLDER }),
  );
});

test("a letter the PDF fonts cannot draw stops the document and is named, never printed wrong", async () => {
  const w = world();
  const id = w.add("Greek.md", enc("# Hello\n\nΩmega {client.name}\n"));
  const e = await expectCode("validation.unsupported", () =>
    handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: { client: { name: "Imran" } },
    }),
  );
  assert.match(e.error.message, /Ω/);
});

test("a long document runs onto more pages, and a signing row never splits across a page edge", async () => {
  const w = world();
  const body = Array.from(
    { length: 120 },
    (_, i) => `Paragraph ${i + 1} of the agreement with some words to fill the line and then a few more.`,
  ).join("\n\n");
  const id = w.add("Long.md", enc(`# Long\n\n${body}\n\n{sign:client} || {sign:firm}\n`));
  const out = await handlers["documents.make_pdf"](w.ctx, { fileId: id, intoFolderId: FOLDER });
  assert.ok(out.pages > 1, `pages ${out.pages}`);
  const where = await handlers["documents.signing"](w.ctx, { fileId: out.file.fileId });
  const places = where.places as { signer: number; page: number; y: number; h: number; kind: string }[];
  const sigs = places.filter((p) => p.kind === "signature");
  assert.equal(sigs.length, 2);
  assert.equal(sigs[0]!.page, sigs[1]!.page, "both signers sign on one page");
  assert.ok(
    sigs.every((p) => p.y + p.h <= 100),
    "inside the page",
  );
});

test("a file the caller may not open is refused, and nothing is made", async () => {
  const w = world();
  const id = w.add("Agreement.md", enc(AGREEMENT));
  w.denied.add(id);
  await expectCode("validation.not_found", () =>
    handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: VALUES,
      signingDate: "2026-11-19",
    }),
  );
  await expectCode("permission.no_grant", () => handlers["documents.signing"](w.ctx, { fileId: id }));
  // a PDF of a document the caller may not open is refused too: the folder is the capability's resource, the source file is checked in the handler
  const before = w.calls.filter((c) => c.cap === "files.write" || c.cap === "files.create").length;
  await assert.rejects(() => handlers["documents.make_pdf"](w.ctx, { fileId: id, intoFolderId: FOLDER }));
  assert.equal(w.calls.filter((c) => c.cap === "files.write" || c.cap === "files.create").length, before, "nothing was made");
});

test("places belong to the version they were set on: a newer version of the file has none, and the answer says it is stale", async () => {
  const w = world();
  const id = w.add("Agreement.md", enc(AGREEMENT));
  const out = await handlers["documents.fill"](w.ctx, {
    templateFileId: id,
    intoFolderId: FOLDER,
    values: VALUES,
    signingDate: "2026-11-19",
  });
  const fresh = await handlers["documents.signing"](w.ctx, { fileId: out.file.fileId });
  assert.equal(fresh.stale, undefined);
  assert.equal(fresh.signers.length, 2);
  w.files.get(out.file.fileId)!.versions = 2; // someone saved a newer version of the PDF
  const stale = await handlers["documents.signing"](w.ctx, { fileId: out.file.fileId });
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.places, []);
});

// ---- documents.make: a template by name, for a record, landing in the record's files ----

/** A Space with a record whose files folder is the main folder. */
function linked(): World {
  const w = world();
  w.records.set("rec_imran", { name: "Imran Ibarra" });
  return w;
}

test("documents.make: a template by name, a record, and the document is in the record's files; the answer is small and never the text", async () => {
  const w = linked();
  const id = w.add("Service agreement.md", enc(AGREEMENT));
  await handlers["documents.mark_template"](w.ctx, { fileId: id, isTemplate: true });
  const out = await handlers["documents.make"](w.ctx, {
    template: "service agreement",
    recordId: "rec_imran",
    values: VALUES,
    signingDate: "2026-11-19",
  });
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.signers, ["client", "firm"]);
  assert.match(out.file.name, /\.pdf$/);
  assert.equal(w.files.get(out.file.fileId)?.folderId, FOLDER);
  // under about 200 tokens of answer whatever the document's length
  assert.ok(JSON.stringify(out).length < 800, JSON.stringify(out).length + " characters");
});

test("documents.make: a name that is nowhere or means two is answered with what there is, and a missing field is named", async () => {
  const w = linked();
  const a = w.add("Service agreement.md", enc(AGREEMENT));
  const b = w.add("Service agreement - long form.md", enc(AGREEMENT));
  await handlers["documents.mark_template"](w.ctx, { fileId: a, isTemplate: true });
  await handlers["documents.mark_template"](w.ctx, { fileId: b, isTemplate: true });
  const none = await expectCode("validation.not_found", () =>
    handlers["documents.make"](w.ctx, {
      template: "Lease",
      recordId: "rec_imran",
      values: VALUES,
      signingDate: "2026-11-19",
    }),
  );
  assert.match(none.error.message, /Service agreement/);
  const two = await expectCode("validation.bad_input", () =>
    handlers["documents.make"](w.ctx, {
      template: "agreement",
      recordId: "rec_imran",
      values: VALUES,
      signingDate: "2026-11-19",
    }),
  );
  assert.match(two.error.message, /More than one/);
  const miss = await expectCode("validation.precondition_failed", () =>
    handlers["documents.make"](w.ctx, {
      template: "Service agreement",
      recordId: "rec_imran",
      signingDate: "2026-11-19",
    }),
  );
  assert.match(miss.error.message, /client\.name|firm\.name/);
  const empty = linked();
  await expectCode("validation.not_found", () =>
    handlers["documents.make"](empty.ctx, { template: "Anything", recordId: "rec_imran" }),
  );
  assert.equal(empty.files.size, 0);
});

test("a Vyre document that still holds suggested changes is refused until they are accepted or rejected, never printed as letters", async () => {
  const w = world();
  const id = w.add("Draft.md", enc("Fee {++1,500 {>>Imran|2026-11-19T10:00:00Z<<}++} for {client.name}.\n"));
  const e = await expectCode("validation.precondition_failed", () =>
    handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: { client: { name: "Imran" } },
    }),
  );
  assert.match(e.error.message, /accept or reject them first/);
  const done = w.add("Done.md", enc("Fee 1,500 for {client.name}.\n"));
  assert.ok(
    (
      await handlers["documents.fill"](w.ctx, {
        templateFileId: done,
        intoFolderId: FOLDER,
        values: { client: { name: "Imran" } },
      })
    ).file.fileId,
  );
  // a front matter block may hold dashes without tripping it
  const fm = w.add("Fm.md", enc("---\nnote: {--x\n---\nHello {client.name}\n"));
  assert.ok(
    (
      await handlers["documents.fill"](w.ctx, {
        templateFileId: fm,
        intoFolderId: FOLDER,
        values: { client: { name: "Imran" } },
      })
    ).file.fileId,
  );
});

test("with no key of its own, fill derives it from what is asked: another value, another record value, an edited template or another format is another file key; the same ask is one key", async () => {
  const w = linked();
  const id = w.add("Service agreement.md", enc(AGREEMENT));
  const keyOf = async (extra: Record<string, unknown> = {}) => {
    const before = w.calls.filter((c) => c.cap === "files.create").length;
    await handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: VALUES,
      signingDate: "2026-11-19",
      ...extra,
    });
    return String(w.calls.filter((c) => c.cap === "files.create")[before]!.input.idempotencyKey).replace(
      /:[^:]*\.pdf$|:[^:]*\.md$/,
      "",
    );
  };
  const base = await keyOf();
  assert.equal(await keyOf(), base, "the same ask is the same key");
  assert.notEqual(await keyOf({ values: { ...VALUES, matter: { fee: 9 } } }), base, "another value");
  assert.notEqual(await keyOf({ signingDate: "2026-11-20" }), base, "another date");
  assert.notEqual(await keyOf({ format: "md" }), base, "another format");
  w.files.get(id)!.versions = 2; // the template was edited
  assert.notEqual(await keyOf(), base, "an edited template");
});

test("documents.make: a retry gives the same document, with the caller's key or without one; another value, person, folder or template version is another document", async () => {
  const w = linked();
  const id = w.add("Service agreement.md", enc(AGREEMENT));
  await handlers["documents.mark_template"](w.ctx, { fileId: id, isTemplate: true });
  const ask = { template: "Service agreement", recordId: "rec_imran", values: VALUES, signingDate: "2026-11-19" };
  const key = async (extra: Record<string, unknown> = {}, who = "per_a") => {
    const before = w.calls.filter((c) => c.cap === "files.create").length;
    await handlers["documents.make"](
      {
        ...w.ctx,
        principal: { kind: "person", id: who },
        trace: { ...w.ctx.trace, traceId: `${Math.random()}`.padEnd(32, "0").slice(0, 32) },
      },
      { ...ask, ...extra },
    );
    return String(w.calls.filter((c) => c.cap === "files.create")[before]!.input.idempotencyKey).replace(
      /:[^:]*\.pdf$/,
      "",
    );
  };
  // no key: the same ask is the same key even though every call has its own trace id
  const base = await key();
  assert.equal(await key(), base, "a retry without a key is the same document");
  assert.notEqual(await key({ values: { ...VALUES, matter: { fee: 7 } } }), base, "another value");
  assert.notEqual(await key({}, "per_b"), base, "another person");
  w.files.get(id)!.versions = 2;
  w.files.get(id)!.bytes = enc(`${AGREEMENT}\nA new closing line.\n`); // edited: new words, new version
  assert.notEqual(await key(), base, "an edited template");
  // the caller's key: a retry is the same, another key is another
  const k1 = await key({ idempotencyKey: "retry-1" });
  assert.equal(await key({ idempotencyKey: "retry-1" }), k1);
  assert.notEqual(await key({ idempotencyKey: "retry-2" }), k1);
});

test("the plain check answers unchecked for a file it cannot read or that is too big, never 'not plain', and a file found plain is not read again", async () => {
  const w = world();
  const id = w.add("Agreement.docx", docx(para("Hello {name}")));
  configureDocuments(null);
  const plain = await handlers["documents.fill"](w.ctx, {
    templateFileId: id,
    intoFolderId: FOLDER,
    values: { name: "Imran" },
    format: "pdf",
  });
  const reads = () => w.calls.filter((c) => c.cap === "files.read").length;
  const firstAsk = await handlers["documents.signing"](w.ctx, { fileId: plain.file.fileId });
  assert.equal(firstAsk.plain, true);
  assert.match(String(firstAsk.checkedSha256), /^[a-f0-9]{64}$/, "the answer says which bytes it read");
  assert.equal(firstAsk.checkedVersion, "1", "and which version of the file");
  const after = reads();
  assert.equal((await handlers["documents.signing"](w.ctx, { fileId: plain.file.fileId })).plain, true);
  assert.equal(reads(), after, "found plain once, not read again for this version");
  const big = w.add("Big.pdf", Buffer.alloc(26 * 1024 * 1024, 1));
  const got = await handlers["documents.signing"](w.ctx, { fileId: big });
  assert.equal(got.unchecked, true);
  assert.equal(got.plain, undefined);
  // unreadable just now: the read throws
  const inner = w.ctx.call.bind(w.ctx);
  const flaky = w.add("Flaky.pdf", Buffer.from("%PDF-1.7 x"));
  w.ctx.call = (async (cap: string, input: unknown) => {
    if (cap === "files.read" && (input as { fileId?: string }).fileId === flaky) throw new Error("storage hiccup");
    return inner(cap as Parameters<typeof inner>[0], input as never);
  }) as typeof w.ctx.call;
  assert.equal((await handlers["documents.signing"](w.ctx, { fileId: flaky })).unchecked, true);
});

test("a key made from what is asked is the full SHA-256: two different asks never share one, the same ask always does", async () => {
  const { askKey } = await import("../handlers/fill.ts");
  const a = await askKey([{ client: { name: "Imran" } }, "2026-11-19"]);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await askKey([{ client: { name: "Imran" } }, "2026-11-19"]));
  assert.notEqual(a, await askKey([{ client: { name: "Imran" } }, "2026-11-20"]));
  assert.notEqual(a, await askKey([{ client: { name: "Imrar" } }, "2026-11-19"]));
});

test("a Word fill with no key of its own is keyed by the resolved record values and the template version: a changed record or an edited template is another file", async () => {
  const w = linked();
  const id = w.add("Letter.docx", docx(para("Dear {name}, your fee is {matter.fee}.")));
  const keyOf = async (extra: Record<string, unknown> = {}) => {
    const n = w.calls.filter((c) => c.cap === "files.create").length;
    await handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      recordId: "rec_imran",
      mapping: { name: "name" },
      values: { matter: { fee: 1 } },
      ...extra,
    });
    return String(w.calls.filter((c) => c.cap === "files.create")[n]!.input.idempotencyKey).replace(
      /:[^:]*\.docx$/,
      "",
    );
  };
  const base = await keyOf();
  assert.equal(await keyOf(), base);
  w.records.set("rec_imran", { name: "Imran Ibarra-Lindahl" });
  assert.notEqual(await keyOf(), base, "the record changed");
  const second = await keyOf();
  w.files.get(id)!.versions = 2;
  assert.notEqual(await keyOf(), second, "the template was edited");
});

test("with no key of its own, the same ask by another person or into another folder is another file, never the first person's file replayed", async () => {
  const w = world();
  const id = w.add("Service agreement.md", enc(AGREEMENT));
  const keyOf = async (into: string, who: string) => {
    const n = w.calls.filter((c) => c.cap === "files.create").length;
    await handlers["documents.fill"](
      { ...w.ctx, principal: { kind: "person", id: who } },
      { templateFileId: id, intoFolderId: into, values: VALUES, signingDate: "2026-11-19" },
    );
    return String(w.calls.filter((c) => c.cap === "files.create")[n]!.input.idempotencyKey).replace(/:[^:]*\.pdf$/, "");
  };
  const a = await keyOf(FOLDER, "per_a");
  assert.equal(await keyOf(FOLDER, "per_a"), a, "the same person, the same folder: the same ask");
  assert.notEqual(await keyOf(FOLDER, "per_b"), a, "another person");
  assert.notEqual(await keyOf("fld_other", "per_a"), a, "another folder");
});

test("with no key of its own, fill for another record is another file even when the folder, template and person are the same and no values are typed", async () => {
  const w = linked();
  w.records.set("rec_other", { name: "Imran Ibarra" });
  const id = w.add("Letter.docx", docx(para("Dear {name}")));
  const keyOf = async (recordId: string) => {
    const n = w.calls.filter((c) => c.cap === "files.create").length;
    await handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      recordId,
      mapping: { name: "name" },
    });
    return String(w.calls.filter((c) => c.cap === "files.create")[n]!.input.idempotencyKey).replace(
      /:[^:]*\.docx$/,
      "",
    );
  };
  const a = await keyOf("rec_imran");
  assert.equal(await keyOf("rec_imran"), a, "the same record again is the same ask");
  assert.notEqual(await keyOf("rec_other"), a, "another record, even with the same words in it");
  w.records.set("rec_imran", { name: "Imran Ibarra (corrected)" });
  assert.notEqual(await keyOf("rec_imran"), a, "the record was corrected: not the old document");
});

test("documents.make with no key: two records, different documents; a corrected record, a new one; a plain retry, the same one", async () => {
  const w = linked();
  w.records.set("rec_other", { name: "Imran Ibarra" });
  const id = w.add("Letter.docx", docx(para("Dear {name}, welcome.")));
  await handlers["documents.mark_template"](w.ctx, { fileId: id, isTemplate: true });
  const keyOf = async (recordId: string) => {
    const n = w.calls.filter((c) => c.cap === "files.create").length;
    await handlers["documents.make"](w.ctx, { template: "Letter", recordId, format: "docx" });
    return String(w.calls.filter((c) => c.cap === "files.create")[n]!.input.idempotencyKey).replace(
      /:[^:]*\.docx$/,
      "",
    );
  };
  const a = await keyOf("rec_imran");
  assert.equal(await keyOf("rec_imran"), a, "a plain retry is the same document");
  assert.notEqual(await keyOf("rec_other"), a, "another record, even with the same words in it");
  w.records.set("rec_imran", { name: "Imran Ibarra (corrected)" });
  assert.notEqual(await keyOf("rec_imran"), a, "a corrected record is a new document");
});

test("documents.make with no key is keyed on every resolved value, not on the shown excerpt: a value only in a footer, or past the 200-entry excerpt cap, changes the key", async () => {
  const w = linked();
  w.records.set("rec_imran", { name: "Imran Ibarra", footer_note: "Valid until June", late: "1,500" });
  const footerDoc = docx(para("Dear {name}, welcome."), {
    "word/footer1.xml": `<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>{footer_note}</w:t></w:r></w:p></w:ftr>`,
  });
  const a = w.add("Footer letter.docx", footerDoc);
  const long = w.add(
    "Schedule.md",
    enc(
      `${Array.from({ length: 260 }, (_, i) => `Item ${i + 1} of the schedule.`).join("\n\n")}\n\nThe last figure is {late}.\n`,
    ),
  );
  await handlers["documents.mark_template"](w.ctx, { fileId: a, isTemplate: true });
  await handlers["documents.mark_template"](w.ctx, { fileId: long, isTemplate: true });
  const keyOf = async (template: string, format: string, ext: string) => {
    const n = w.calls.filter((c) => c.cap === "files.create").length;
    await handlers["documents.make"](w.ctx, { template, recordId: "rec_imran", format } as never);
    return String(w.calls.filter((c) => c.cap === "files.create")[n]!.input.idempotencyKey).replace(
      new RegExp(`:[^:]*\\.${ext}$`),
      "",
    );
  };
  const footer1 = await keyOf("Footer letter", "docx", "docx");
  assert.equal(await keyOf("Footer letter", "docx", "docx"), footer1);
  w.records.set("rec_imran", { name: "Imran Ibarra", footer_note: "Valid until July", late: "1,500" });
  assert.notEqual(await keyOf("Footer letter", "docx", "docx"), footer1, "a value only in the footer was corrected");
  const late1 = await keyOf("Schedule", "md", "md");
  w.records.set("rec_imran", { name: "Imran Ibarra", footer_note: "Valid until July", late: "2,500" });
  assert.notEqual(await keyOf("Schedule", "md", "md"), late1, "a value past the 200th excerpt entry was corrected");
  // the excerpt really is capped: the preview shows no trace of the late figure
  const shown = (await handlers["documents.preview_fill"](w.ctx, { templateFileId: long, recordId: "rec_imran" })) as {
    excerpt: { text: string }[];
    digest: string;
  };
  assert.ok(!shown.excerpt.some((e) => e.text.includes("2,500")), "past the cap, not shown");
  assert.match(shown.digest, /^[0-9a-f]{64}$/);
});

test("the preview digest follows the template's own bytes too: an edit to the template changes it even when no version is reported", async () => {
  const w = linked();
  const id = w.add("Letter.md", enc("Dear {name}, welcome.\n"));
  const digest = async () =>
    (
      (await handlers["documents.preview_fill"](w.ctx, { templateFileId: id, recordId: "rec_imran" })) as {
        digest: string;
      }
    ).digest;
  const a = await digest();
  assert.equal(await digest(), a);
  w.files.get(id)!.bytes = enc("Dear {name}, welcome back.\n"); // edited; the version number is not touched
  assert.notEqual(await digest(), a);
});
