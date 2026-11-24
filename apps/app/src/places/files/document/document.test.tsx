// @tsx
// New document, from a template: the state machine (every move, every failure, no dead end, nothing typed is lost), the sheet in each state, and the calls against a fake of the server's answers.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentSheet } from "./DocumentSheet.tsx";
import { loadTemplates, makeDocument, readTemplate } from "./actions.ts";
import { asked, canMake, initial, labelOf, offered, previewOf, step, stillEmpty, valuesOf, whyNot } from "./model.ts";
import type { DocEvent, DocState, Preview, TemplateRow } from "./model.ts";

const AGREEMENT: TemplateRow = { fileId: "fil_a", name: "Service agreement.md", fields: 3, recordType: "customer" };
const NDA: TemplateRow = { fileId: "fil_b", name: "Mutual NDA.docx", fields: 2 };
const OTHER: TemplateRow = { fileId: "fil_c", name: "Offer letter.docx", fields: 4, recordType: "person" };

const preview = (missing: string[] = ["client.name", "matter.fee"]): Preview => ({
  fields: [
    { name: "firm.name", kind: "text", required: true },
    { name: "client.name", kind: "text", required: true },
    { name: "matter.fee", kind: "money", required: true },
    { name: "signing_date", kind: "date", required: true },
  ],
  excerpt: [{ text: "Between Northwind and ____", filled: [{ from: 8, to: 17, field: "firm.name" }] }],
  missing,
  signers: ["client", "firm"],
  problems: [],
});
const T = (): DocState => step(initial(), { t: "templates", list: [AGREEMENT, NDA, OTHER] });
const ready = (missing?: string[]): Extract<DocState, { phase: "fill" }> => {
  let s = step(T(), { t: "pick", template: AGREEMENT, today: "2026-11-19" });
  assert.equal(s.phase, "fill");
  s = step(s, { t: "previewed", token: (s as { token: number }).token, preview: preview(missing) });
  return s as Extract<DocState, { phase: "fill" }>;
};

test("templates for this kind of record come first, then the ones for any; another kind's are not offered", () => {
  const names = offered([AGREEMENT, NDA, OTHER], "customer").map((t) => t.name);
  assert.deepEqual(names, ["Service agreement.md", "Mutual NDA.docx"]);
  assert.deepEqual(
    offered([AGREEMENT, NDA, OTHER], "person").map((t) => t.name),
    ["Offer letter.docx", "Mutual NDA.docx"],
  );
});

test("a template opens, asks only for what the record did not give, and Make waits until every field has a value", () => {
  let s = ready();
  assert.deepEqual(
    asked(s.preview).map((f) => f.name),
    ["client.name", "matter.fee"],
  );
  assert.equal(canMake(s), false);
  assert.match(String(whyNot(s)), /Still empty: Client name, Matter fee/);
  s = step(s, { t: "edit", name: "client.name", value: "Imran Ibarra" }) as typeof s;
  assert.match(String(whyNot(s)), /Still empty: Matter fee/);
  s = step(s, { t: "edit", name: "matter.fee", value: "1,500" }) as typeof s;
  assert.equal(whyNot(s), null);
  assert.equal(canMake(s), true);
  // a bad signing date is named, not sent
  s = step(s, { t: "date", value: "tomorrow" }) as typeof s;
  assert.match(String(whyNot(s)), /signing date/i);
  assert.equal(
    step(s, { t: "make" }).phase === "fill" && (step(s, { t: "make" }) as { status: string }).status,
    "ready",
    "Make is refused",
  );
});

test("making: a failure keeps everything typed and the page can be made again; a late answer to a replaced request is ignored", () => {
  let s = ready();
  s = step(s, { t: "edit", name: "client.name", value: "Imran" }) as typeof s;
  s = step(s, { t: "edit", name: "matter.fee", value: "1500" }) as typeof s;
  s = step(s, { t: "make" }) as typeof s;
  assert.equal(s.status, "making");
  const first = s.token;
  // an answer from before this press
  assert.equal(step(s, { t: "made", token: first - 1, made: { fileId: "x", name: "x.pdf", signers: [] } }), s);
  const failed = step(s, { t: "make_failed", token: first, error: "The Space is busy." }) as typeof s;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "The Space is busy.");
  assert.deepEqual(failed.values, { "client.name": "Imran", "matter.fee": "1500" }, "nothing typed is lost");
  assert.equal(canMake(failed), true, "it can be made again");
  const again = step(failed, { t: "make" }) as typeof s;
  assert.equal(again.status, "making");
  const done = step(again, {
    t: "made",
    token: again.token,
    made: { fileId: "fil_9", name: "Service agreement (filled).pdf", signers: ["client", "firm"] },
  });
  assert.equal(done.phase, "made");
});

test("every state has a way out: Back from a template, from a failure and from a made document, and a failed list can be tried again", () => {
  const failedList = step(initial(), { t: "templates_failed", error: "That did not go through. Try again." });
  assert.equal(failedList.phase === "templates" && failedList.status, "failed");
  assert.equal((step(failedList, { t: "reload" }) as { status: string }).status, "loading");
  const failedOpen = step(step(T(), { t: "pick", template: NDA, today: "2026-11-19" }), {
    t: "preview_failed",
    token: 1,
    error: "That template cannot be opened.",
  });
  assert.equal(failedOpen.phase === "fill" && failedOpen.status, "failed");
  assert.equal(step(failedOpen, { t: "back" }).phase, "templates");
  assert.equal(step(ready(), { t: "back" }).phase, "templates");
  const made = step(step(step(step(ready([]), { t: "make" }), { t: "check" }), { t: "back" }), {
    t: "pick",
    template: AGREEMENT,
    today: "2026-11-19",
  });
  assert.equal(made.phase, "fill");
});

test("random moves in any order never leave a dead end and never lose what was typed (300 sequences)", () => {
  let seed = 7;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pickOf = <X,>(xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)] as X;
  for (let n = 0; n < 300; n++) {
    let s: DocState = initial();
    const log: string[] = [];
    let typed: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      const tok = s.phase === "fill" ? s.token : 0;
      const e: DocEvent = pickOf<DocEvent>([
        { t: "templates", list: [AGREEMENT, NDA] },
        { t: "templates_failed", error: "no" },
        { t: "reload" },
        { t: "pick", template: pickOf([AGREEMENT, NDA]), today: "2026-11-19" },
        { t: "previewed", token: tok, preview: preview() },
        { t: "previewed", token: tok - 1, preview: preview([]) },
        { t: "preview_failed", token: tok, error: "no" },
        { t: "edit", name: "client.name", value: pickOf(["", "A", "Imran"]) },
        { t: "edit", name: "matter.fee", value: pickOf(["", "1500"]) },
        { t: "date", value: pickOf(["2026-11-19", "x"]) },
        { t: "format", format: pickOf(["pdf", "docx", "md"] as const) },
        { t: "check" },
        { t: "make" },
        { t: "made", token: tok, made: { fileId: "f", name: "f.pdf", signers: [] } },
        { t: "make_failed", token: tok, error: "no" },
        { t: "back" },
      ]);
      log.push(e.t);
      const before = s;
      s = step(s, e);
      // typed values only change by edits, and only a new pick clears them
      if (s.phase === "fill" && before.phase === "fill" && e.t !== "pick" && e.t !== "edit")
        assert.deepEqual(s.values, before.values, `sequence ${n}: ${log.join(",")} lost what was typed`);
      if (s.phase === "fill") typed = s.values;
      // the signing date and format are always legal
      if (s.phase === "fill") assert.ok(["pdf", "docx", "md"].includes(s.format));
      // a way out always exists
      const out = step(s, { t: "back" });
      assert.ok(
        s.phase === "templates" ? true : out.phase === "templates",
        `sequence ${n}: no way back from ${s.phase}`,
      );
    }
    void typed;
  }
});

test("values: a dotted field is a group, an amount that reads as a number is one, an empty field is left out for the server to name", () => {
  const kinds = new Map([["matter.fee", "money" as const]]);
  assert.deepEqual(valuesOf({ "client.name": " Imran ", "matter.fee": "$1,500.50", "firm.name": "" }, kinds), {
    client: { name: "Imran" },
    matter: { fee: 1500.5 },
  });
  assert.equal(labelOf("client.name"), "Client name");
  assert.equal(labelOf("matter_fee"), "Matter fee");
});

test("a template with a list to repeat is not made from the sheet, and its page says why", () => {
  const p: Preview = {
    ...preview(["items.label"]),
    fields: [
      { name: "items", kind: "loop", required: true },
      { name: "items.label", kind: "text", required: true, loop: "items" },
    ],
  };
  let s = step(T(), { t: "pick", template: AGREEMENT, today: "2026-11-19" });
  s = step(s, { t: "previewed", token: (s as { token: number }).token, preview: p });
  assert.match(String(whyNot(s as Extract<DocState, { phase: "fill" }>)), /repeats a list/);
  assert.deepEqual(stillEmpty(s as Extract<DocState, { phase: "fill" }>), []);
});

test("previewOf reads the two answers into one page, and refuses an answer that is not shaped like them", () => {
  const p = previewOf(
    { fields: [{ name: "a", kind: "text", required: true }], signers: ["client"], problems: [{ message: "A thing." }] },
    { excerpt: [{ text: "Hi", filled: [] }], missing: ["a"] },
  );
  assert.deepEqual(p?.missing, ["a"]);
  assert.deepEqual(p?.problems, ["A thing."]);
  assert.equal(previewOf(null, {}), null);
});

const noop = (): void => undefined;
const call = async (): Promise<unknown> => ({});
const html = (start: DocState): string =>
  renderToStaticMarkup(
    <DocumentSheet
      call={call}
      recordId="rec_1"
      recordType="customer"
      folderId="fld_1"
      today="2026-11-19"
      start={start}
      onClose={noop}
      onSign={noop}
      onOpen={noop}
    />,
  ).replaceAll("<!-- -->", "");

test("the sheet: templates, the filled page with its fields, the made state with Send for signature", () => {
  const list = html(T());
  for (const want of ["New document", "Service agreement", "Mutual NDA", "3 fields", "Cancel"])
    assert.ok(list.includes(want), want);
  assert.ok(!list.includes("Offer letter"), "another kind's template is not offered");
  assert.ok(
    html(step(initial(), { t: "templates", list: [] })).includes("mark a Word file or a document as a template"),
  );
  assert.ok(
    html(step(initial(), { t: "templates_failed", error: "The Space is busy." })).includes("The Space is busy."),
  );
  const fill = html(ready());
  for (const want of [
    "Fields to fill",
    "Client name",
    "Matter fee",
    "Signing date",
    "Make PDF",
    "Back",
    "Between",
    "Northwind",
    "Signs: Client, Firm",
    "Still empty",
  ])
    assert.ok(fill.includes(want), `missing ${want}`);
  assert.ok(!/placeholder|\btag\b/i.test(fill.replace(/<[^>]*>/g, " ")), "the products words: Fields");
  let s = ready();
  s = step(s, { t: "make" }) as typeof s;
  const made = html({
    phase: "made",
    templates: [AGREEMENT],
    template: AGREEMENT,
    made: {
      fileId: "fil_9",
      name: "Agreement.pdf",
      signers: ["client", "firm"],
      layout: "simple",
      converter: "pulling",
    },
  });
  for (const want of [
    "Document made",
    "Agreement.pdf",
    "2 people sign",
    "Send for signature",
    "Letterhead and pictures are missing",
    "make the PDF again in a minute",
    "Make another",
  ])
    assert.ok(made.includes(want), `missing ${want}`);
  const word = html({
    phase: "made",
    templates: [],
    template: NDA,
    made: { fileId: "fil_9", name: "NDA.docx", signers: [] },
  });
  assert.ok(!word.includes("Send for signature") && word.includes("Done"), "a Word file is not sent for signature");
});

test("the calls: templates list, the page, and Make with one key for one press", async () => {
  const sent: { cap: string; input: Record<string, unknown> }[] = [];
  const server: Record<string, (i: Record<string, unknown>) => unknown> = {
    "documents.templates.list": () => ({
      templates: [
        { fileId: "fil_a", name: "Service agreement.md", fields: 3, recordType: "customer" },
        { nonsense: true },
      ],
    }),
    "documents.fields": () => ({
      fields: [{ name: "client.name", kind: "text", required: true }],
      signers: ["client"],
      problems: [],
    }),
    "documents.preview_fill": () => ({ excerpt: [{ text: "Hi", filled: [] }], missing: ["client.name"] }),
    "documents.fill": () => ({
      file: { fileId: "fil_9", name: "A.pdf", versionId: "ver_1" },
      missing: [],
      signers: ["client"],
      layout: "word",
    }),
  };
  const c = async (cap: string, input: unknown): Promise<unknown> => {
    sent.push({ cap, input: input as Record<string, unknown> });
    const f = server[cap];
    if (!f) throw { error: { message: "That is not here." } };
    return f(input as Record<string, unknown>);
  };
  const list = await loadTemplates(c);
  assert.deepEqual(list.ok && list.value.map((t) => t.fileId), ["fil_a"]);
  const page = await readTemplate(c, AGREEMENT, "rec_1", {
    values: { "client.name": "Imran" },
    signingDate: "2026-11-19",
    kinds: new Map(),
  });
  assert.ok(page.ok);
  assert.deepEqual(sent.find((x) => x.cap === "documents.preview_fill")!.input.values, { client: { name: "Imran" } });
  const made = await makeDocument(c, {
    template: AGREEMENT,
    recordId: "rec_1",
    folderId: "fld_1",
    values: { "client.name": "Imran" },
    signingDate: "2026-11-19",
    kinds: new Map(),
    format: "pdf",
    key: "k1",
  });
  assert.deepEqual(made.ok && made.value, { fileId: "fil_9", name: "A.pdf", signers: ["client"], layout: "word" });
  assert.equal(sent.find((x) => x.cap === "documents.fill")!.input.idempotencyKey, "k1");
  // the server's own sentence comes back untouched
  server["documents.fill"] = () => {
    throw { error: { message: "The document was not made: this value is missing: client.name" } };
  };
  const bad = await makeDocument(c, {
    template: AGREEMENT,
    recordId: "rec_1",
    folderId: "fld_1",
    values: {},
    signingDate: "2026-11-19",
    kinds: new Map(),
    format: "pdf",
    key: "k2",
  });
  assert.deepEqual(bad, { ok: false, error: "The document was not made: this value is missing: client.name" });
});
