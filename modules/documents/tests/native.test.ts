// documents: the Vyre document as a template (lane r42-docs). A Markdown template fills by the same rules as a Word one and comes out as a PDF set in process; {sign:role} places are
// remembered and answered; a blank still in a document stops its PDF; the same input gives the same bytes; a letter the fonts cannot draw is refused, not misprinted.
// @reads /modules/documents/migrations/0003_documents_signing.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { handlers } from "../impl.ts";
import { world, FOLDER } from "../fixtures/world.ts";
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
  assert.deepEqual(await handlers["documents.signing"](w.ctx, { fileId: id }), { signers: [], places: [] });
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
