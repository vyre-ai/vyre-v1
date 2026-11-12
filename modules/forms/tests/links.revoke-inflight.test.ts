// A record link revoked while a submit is already on its way is in force: the submit that checked the link before the revoke, and is still checking its answers when the revoke lands, does not
// go through. The revoke is made inside the submit's own await (the schema read every submit does before it writes), so the order is fixed, not timed.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { code, openForm, run } from "../fixtures/seed.ts";
import type { OpenForm } from "../fixtures/seed.ts";
import { configureForms } from "../projections.ts";

const RECORD = "rec_c1";
const SCHEMA = [{ key: "email", title: "Email", type: "email" }, { key: "name", title: "Name", type: "text" }, { key: "phone", title: "Phone", type: "text" }];

async function linkFor(w: World, f: OpenForm, singleUse: boolean): Promise<string> {
  const out = await run<{ url: string }>(w.ctx, "forms.link_create", { formId: f.formId, recordId: RECORD, singleUse });
  return new URL(out.url).searchParams.get("t")!;
}

for (const singleUse of [true, false]) {
  test(`a ${singleUse ? "one-use" : "signed"} link revoked while a submit is in flight: the submit is refused and nothing is written`, async () => {
    const w = harness();
    w.addRecord({ id: RECORD, type: "contact", fields: { email: "dana@x.example" } });
    const f = await openForm(w);
    const token = await linkFor(w, f, singleUse);
    let revoked = false;
    configureForms({
      schemaFields: async () => {
        // the submit has resolved the link and is reading the record type: the link is revoked now, before it writes
        if (!revoked) { revoked = true; await run(w.ctx, "forms.link_revoke", { formId: f.formId, token }); }
        return SCHEMA;
      },
    });
    try {
      assert.equal(await code(run(f.public, "forms.submit", { slug: f.slug, token, answers: { name: "Dana Reyes", phone: "555 0101" } })), "auth.invalid_code");
      assert.equal(revoked, true, "the revoke landed inside the submit");
      assert.equal(w.db.rows("forms_submission").length, 0, "no submission was stored");
      assert.equal(w.calls.filter((c) => c.cap === "records.update" || c.cap === "records.create").length, 0, "the record was not written");
      assert.equal(await code(run(f.public, "forms.save_partial", { slug: f.slug, token, answers: { name: "x" } })), "auth.invalid_code");
    } finally { configureForms(null); }
  });
}
