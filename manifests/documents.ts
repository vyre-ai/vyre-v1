// documents (lane L4): fill the firm's real Word template with values, deterministically (docxtemplater; reuse of 0.6 core/documents).
// A filled document is made only by filling a template. Nothing here writes or rewrites document text with a model: a wrong result is fixed by the data or the template.
// DECISION: a template is a docx file flagged with documents.mark_template; the flag is metadata on the file, not a new version.
// DECISION: documents.fill checks Edit on the target folder; the handler also checks View on the template file, because a capability binds one resource.
// DECISION: values are never typed into a date by the model: the signing date is an explicit input, ISO form, and formats come from the template tags.
// DECISION (r42-docs): a template can be for one record type (mark_template recordType); a tag that reads through a link field ({contact.name}) is fed from the linked record, one step away.
// DECISION (r42-docs): a Vyre document (a Markdown file) is a template too. It fills by the same rules and comes out as a PDF set in process (no converter app), so a Space with
// nothing installed goes from a template to a signature. {sign:role} in its text is where a signer signs: the PDF remembers the places and documents.signing answers them.
// DECISION (r42-docs): making a document is a Flow step (documents.fill): fill, then the sign step, is one Flow. It writes a file and sends nothing, so it is not a Gate act.
import { create, defineManifest, ev, read, screen, step, t, write } from "../packages/contracts/src/index.ts";
import { id, pageIn, pageOut } from "./_common.ts";

const fieldInfo = t.obj({
  name: t.str({ examples: ["grantor_name"] }),
  kind: t.enm("text", "date", "money", "list", "condition", "loop"),
  required: t.bool(),
  loop: t.opt(t.str({ description: "Name of the list this field sits in" })),
});

const fillIn = {
  templateFileId: id.file,
  values: t.opt(t.rec()),
  recordId: t.opt(id.record),
  mapping: t.opt(t.rec(t.str({ description: "Record field key that feeds the template field" }))),
  signingDate: t.opt(t.str({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date", examples: ["2026-10-24"] })),
};

const templateRow = t.obj({
  fileId: id.file,
  name: t.str(),
  folderId: id.folder,
  fields: t.int({ minimum: 0 }),
  updatedAt: t.ts(),
  recordType: t.opt(
    t.str({ description: "Key of the record type this template is for; absent when it is for any record" }),
  ),
});
const signers = t.opt(
  t.arr(t.str(), {
    description: "Signer roles the document names with {sign:role}, in signing order; absent when it names none",
  }),
);
const savedFile = t.obj({ fileId: id.file, name: t.str(), versionId: id.version });
const tpl = (d: string) => t.str({ description: `${d}. Templating allowed: {{ trigger.x }}, {{ steps.name.out.y }}` });

export default defineManifest({
  id: "documents",
  title: "Documents",
  owner: "L4",
  events: [
    ev("document.filled", "A document was made by filling a template", {
      p: { fileId: id.file, templateFileId: id.file, fields: t.int(), missing: t.int(), recordId: t.opt(id.record) },
      subject: ["file", "/fileId"],
      label: "subject",
      trigger: { title: "A document is filled from a template", fields: ["/templateFileId"] },
    }),
    ev("document.template_marked", "A file was marked or unmarked as a template", {
      p: { fileId: id.file, isTemplate: t.bool(), recordType: t.opt(t.str()) },
      subject: ["file", "/fileId"],
      label: "subject",
    }),
  ],
  capabilities: [
    read(
      "documents.fields",
      "List the fields a template needs (the {blanks} in it): text, date, money, lists and conditions",
      {
        in: { templateFileId: id.file },
        out: {
          fields: t.arr(fieldInfo),
          loops: t.arr(t.str()),
          problems: t.arr(
            t.obj({ message: t.str(), tag: t.opt(t.str({ description: "The field the problem is about" })) }),
          ),
          signers,
        },
        on: ["file", "/templateFileId"],
        tool: "files",
        label: "check",
      },
    ),
    read(
      "documents.preview_fill",
      "Show the filled document as an excerpt with every filled value marked, and what is missing or unused",
      {
        in: fillIn,
        out: {
          excerpt: t.arr(
            t.obj({ text: t.str(), filled: t.arr(t.obj({ from: t.int(), to: t.int(), field: t.str() })) }),
          ),
          missing: t.arr(t.str()),
          unused: t.arr(t.str()),
        },
        on: ["file", "/templateFileId"],
        tool: "files",
        label: "check",
      },
    ),
    create(
      "documents.fill",
      "Fill a template into a new file in a folder; missing required fields stop the fill and are listed",
      {
        in: {
          ...fillIn,
          intoFolderId: id.folder,
          name: t.opt(t.str()),
          format: t.opt(
            t.enm("docx", "pdf", "md", {
              description:
                "A Word template fills to docx or pdf; a Vyre document fills to pdf, or to md to go on editing",
            }),
          ),
        },
        out: {
          file: savedFile,
          missing: t.arr(t.str()),
          unused: t.arr(t.str()),
          signers,
          layout: t.opt(
            t.enm("word", "simple", {
              description: "word: the Word page kept; simple: plain page look (no converter)",
            }),
          ),
        },
        make: ["file", "/intoFolderId"],
        perm: "files.write",
        emits: ["document.filled", "file.created", "file.version_added"],
        tool: "files",
        cli: "vyre documents fill",
        errors: ["validation.precondition_failed", "validation.not_found", "validation.unsupported"],
      },
    ),
    write(
      "documents.make",
      "Make a document for a record from a template by name: it lands in the record's files and the answer is the file and what was missing, never the text",
      {
        in: {
          template: t.str({ description: "The template's name, or its file id", examples: ["Service agreement"] }),
          recordId: id.record,
          values: t.opt(t.rec()),
          signingDate: t.opt(t.str({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date", examples: ["2026-10-24"] })),
          name: t.opt(t.str()),
          format: t.opt(t.enm("docx", "pdf", "md")),
        },
        out: { file: savedFile, missing: t.arr(t.str()), signers, layout: t.opt(t.enm("word", "simple")) },
        on: ["record", "/recordId"],
        level: "use",
        emits: ["document.filled", "file.created", "file.version_added"],
        tool: "files",
        errors: ["validation.precondition_failed", "validation.not_found", "validation.unsupported"],
      },
    ),
    create(
      "documents.make_pdf",
      "Make a PDF of a Vyre document (.md) in a folder; a blank still in its text stops it and is named",
      {
        in: { fileId: id.file, intoFolderId: id.folder, name: t.opt(t.str()) },
        out: { file: savedFile, pages: t.int({ minimum: 1 }), signers },
        make: ["file", "/intoFolderId"],
        perm: "files.write",
        emits: ["file.created", "file.version_added"],
        tool: "files",
        errors: ["validation.precondition_failed", "validation.not_found", "validation.unsupported"],
      },
    ),
    read(
      "documents.signing",
      "Where the signers of a PDF made from a Vyre document sign, and what it was filled from",
      {
        in: { fileId: id.file },
        out: {
          signers: t.arr(t.str()),
          places: t.arr(t.json()),
          stale: t.opt(t.bool()),
          templateFileId: t.opt(id.file),
          recordId: t.opt(id.record),
        },
        on: ["file", "/fileId"],
        tool: "files",
        label: "check",
      },
    ),
    read("documents.templates.list", "List files marked as templates the caller can open", {
      in: {
        folder: t.opt(id.folder),
        recordType: t.opt(t.str({ description: "Only templates for this record type", examples: ["customer"] })),
        name: t.opt(t.str({ description: "Only the template with this name, any case, with or without .docx" })),
        ...pageIn,
      },
      out: { templates: t.arr(templateRow), ...pageOut },
      tool: "files",
      label: "filter",
    }),
    write(
      "documents.mark_template",
      "Mark a Word file (.docx) or a Vyre document (.md) as a template, optionally for one record type, or unmark it",
      {
        in: {
          fileId: id.file,
          isTemplate: t.bool(),
          recordType: t.opt(
            t.str({ description: "Key of the record type this template is for", examples: ["customer"] }),
          ),
        },
        out: { ok: t.bool() },
        on: ["file", "/fileId"],
        perm: "files.write",
        emits: ["document.template_marked"],
        tool: "files",
        errors: ["validation.unsupported", "validation.not_found"],
      },
    ),
  ],
  steps: [
    step("documents.fill", "Documents · Make a document from a template", "data", "capability", {
      cap: "documents.fill",
      effects: "write",
      idempotency: "key",
      errors: [
        "validation.bad_input",
        "internal.unexpected",
        "validation.precondition_failed",
        "validation.not_found",
        "validation.unsupported",
      ],
      in: {
        templateFileId: id.file,
        intoFolderId: id.folder,
        recordId: t.opt(id.record),
        values: t.opt(t.rec()),
        signingDate: t.opt(tpl("Signing date, ISO form")),
        name: t.opt(tpl("File name")),
        format: t.opt(t.enm("docx", "pdf", "md")),
      },
      out: { file: savedFile, missing: t.arr(t.str()), signers },
    }),
  ],
  screens: [
    screen("files.fill-sheet", "files", "ui:FillSheet", {
      slot: "sheet",
      q: {
        fields: ["documents.fields", { templateFileId: "/state/fileId" }],
        preview: [
          "documents.preview_fill",
          {
            templateFileId: "/state/fileId",
            values: "/draft/values",
            recordId: "/draft/recordId",
            signingDate: "/draft/signingDate",
          },
          false,
        ],
      },
      a: {
        fill: [
          "documents.fill",
          {
            templateFileId: "/state/fileId",
            intoFolderId: "/state/into",
            values: "/draft/values",
            recordId: "/draft/recordId",
            signingDate: "/draft/signingDate",
            format: "/draft/format",
          },
        ],
      },
      needs: ["files.write"],
      primary: "Fill the document",
    }),
  ],
});
