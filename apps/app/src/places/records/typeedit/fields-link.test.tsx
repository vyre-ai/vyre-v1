// Fields panel: Link to another record type and the groups-to-tabs hint.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { FieldsPanel, ADDABLE, canSeal, confirmLine, linkFieldOps, sealBlocked, sealFieldOps, sensitiveKind } from "./index.ts";
import type { PanelType } from "./index.ts";

const has = (s: string, needle: string): boolean => s.replaceAll("<!-- -->", "").includes(needle);
const deal: PanelType = { key: "deal", title: "Deal", plural: "Deals", system: false, titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "contact", type: "relation", title: "Contact" }] };

test("a link is one relation.add that names both ends and keeps both keys free", () => {
  const made = linkFieldOps({ type: "deal", plural: "Deals", name: "", to: { key: "contact", title: "Contact", plural: "Contacts" }, takenKeys: ["name", "contact"], farKeys: ["name", "deals"] });
  assert.equal(made.key, "contact_2");
  assert.deepEqual(made.ops, [{ op: "relation.add", type: "deal", field: "contact_2", def: { to: "contact", inverse: "deals_2", title: "Contact", inverseTitle: "Deals" } }]);
  const named = linkFieldOps({ type: "deal", plural: "Deals", name: "Buyer", to: { key: "contact", title: "Contact", plural: "Contacts" }, takenKeys: ["name"], farKeys: [] });
  assert.equal(named.key, "buyer");
  assert.equal((named.ops[0]!.def as { inverse: string }).inverse, "deals");
});

test("a link to the same type keeps its two ends apart", () => {
  const made = linkFieldOps({ type: "company", plural: "Companies", name: "Parent", to: { key: "company", title: "Company", plural: "Companies" }, takenKeys: ["name"], farKeys: ["name"] });
  assert.equal(made.key, "parent");
  assert.equal((made.ops[0]!.def as { inverse: string }).inverse, "companies");
});

test("the panel says three or more groups show as tabs and offers Link to", () => {
  const closed = renderToStaticMarkup(<FieldsPanel call={async () => ({})} type={deal} hidden={[]} onToggleHidden={() => undefined} onClose={() => undefined} fieldTypes={[]} trash={[]} layout={[]} linkTypes={[{ key: "contact", title: "Contact", plural: "Contacts" }]} />);
  assert.ok(has(closed, "Three or more groups show as tabs."));
  assert.ok(has(closed, 'data-testid="panel-scan"') && has(closed, "Check for sensitive data"));
  assert.ok(!has(closed, 'data-testid="panel-add-type-link"'));
});

test("sealing: Sealed can be added, only text-like fields can be sealed, and the confirm says it is one way", () => {
  assert.ok((ADDABLE as readonly string[]).includes("sealed"));
  for (const t of ["text", "longtext", "email", "phone", "number", "url"]) assert.equal(canSeal({ type: t }), true, t);
  for (const t of ["money", "choice", "sealed", "files", "relation"]) assert.equal(canSeal({ type: t }), false, t);
  assert.equal(sealBlocked({ system: false }, "name", "taxid"), null);
  assert.match(sealBlocked({ system: false }, "name", "name")!, /names the record/);
  assert.match(sealBlocked({ system: true }, "name", "taxid")!, /Built in/);
  assert.deepEqual(sealFieldOps("client", "taxid"), [{ op: "field.retype", type: "client", field: "taxid", toType: "sealed" }]);
  assert.match(confirmLine("field.seal", "Tax ID", 50), /50 values move into the Vault\. This cannot be undone/);
  assert.equal(sensitiveKind("id_number"), "an ID number");
});
