// mail.send with a template (lane r42-email-in): the named template fills subject and body once; a field with no value stops the send and is named;
// a template and own words are never mixed; the document's own version is used; a message held for later keeps its filled words. Nothing leaves the process.
import test from "node:test";
import assert from "node:assert/strict";
import { send } from "../handlers/send.ts";
import { forDocumentSet, save } from "../handlers/extra/template.ts";
import { codeOf, contractErrors } from "../fixtures/harness.ts";
import { rig, sendIn } from "./send.rig.test.ts";
import type { Rig } from "./send.rig.test.ts";

const DOC = "fil_doc0001";

function withRecords(r: Rig): Rig {
  const base = r.ctx.call.bind(r.ctx);
  r.ctx.call = async (cap, input) => {
    const body = input as Record<string, unknown>;
    if (cap === "schema.types.list") return { types: [{ key: "contact" }] };
    if (cap === "schema.types.get")
      return { type: { key: "contact", fields: [{ key: "signer_name", options: { mergeable: true } }] } };
    if (cap === "records.get") return { record: { id: body.recordId, fields: { signer_name: "Sam Rivers" } } };
    return base(cap, input);
  };
  return r;
}

const base = { document_title: "Service agreement", sender_name: "Pat Lee", sign_link: "https://sign.vyre.test/a" };
const templated = (over: Record<string, unknown> = {}) => {
  const { subject: _s, text: _t, ...rest } = sendIn();
  return { ...rest, templateKey: "signature.request", vars: base, ...over } as unknown as ReturnType<typeof sendIn>;
};

test("a template send fills the subject and the body, from the record and the values, and goes out once", async () => {
  const r = withRecords(rig());
  const input = templated({ recordId: "rec_signer01" });
  assert.deepEqual(contractErrors("mail.send", "in", input), []);
  const out = await send(r.ctx, input);
  assert.equal(out.status, "sent");
  const call = r.sent()[0]!.input;
  assert.equal(call.subject, "Pat Lee asked you to sign Service agreement");
  assert.match(String(call.text), /^Hi Sam Rivers,/);
  assert.match(String(call.text), /https:\/\/sign\.vyre\.test\/a/);
  // the same send again (a retry from the caller) answers the same and sends nothing more
  assert.deepEqual(await send(r.ctx, input), out);
  assert.equal(r.sent().length, 1);
});

test("a field with no value stops the send and is named; nothing is stored or sent", async () => {
  const r = withRecords(rig());
  await assert.rejects(
    send(r.ctx, templated({ vars: { document_title: "Plan", sender_name: "Pat" } })),
    (e) =>
      codeOf(e) === "validation.precondition_failed" &&
      /still needs a value for sign_link/.test(String((e as Error).message ?? JSON.stringify(e))),
  );
  assert.equal(r.sent().length, 0);
  assert.equal(r.h.rows(`SELECT id FROM mail_message`).length, 0);
});

test("a template and your own words are never mixed, and an unknown template is refused", async () => {
  const r = withRecords(rig());
  await assert.rejects(send(r.ctx, templated({ subject: "Mine" })), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(
    send(r.ctx, templated({ templateKey: "no.such.key" })),
    (e) => codeOf(e) === "validation.not_found",
  );
  await assert.rejects(
    send(r.ctx, sendIn({ subject: undefined as unknown as string })),
    (e) => codeOf(e) === "validation.bad_input",
  );
  assert.equal(r.sent().length, 0);
});

test("the document's own version is used when the send names the document, the Space's version otherwise", async () => {
  const r = withRecords(rig());
  await save(r.ctx, {
    key: "signature.request",
    subject: "Space: {{document_title}}",
    text: "Space body {{sign_link}}",
  });
  await forDocumentSet(r.ctx, {
    documentId: DOC,
    key: "signature.request",
    subject: "Doc: {{document_title}}",
    text: "Doc body {{sign_link}}",
  });
  await send(r.ctx, templated({ documentId: DOC }));
  await send(r.ctx, templated());
  assert.deepEqual(
    r.sent().map((s) => s.input.subject),
    ["Doc: Service agreement", "Space: Service agreement"],
  );
});

test("a template send held for later keeps the words it was filled with", async () => {
  const r = withRecords(rig());
  const out = await send(r.ctx, templated({ sendAt: r.ctx.now() + 3_600_000 }));
  assert.equal(out.status, "queued");
  const again = r.scheduled[0]!.input;
  assert.equal(again.subject, "Pat Lee asked you to sign Service agreement");
  assert.equal(again.templateKey, undefined);
  assert.equal(again.vars, undefined);
});
