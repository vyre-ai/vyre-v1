// The whole of a per-matter intake system through validate and preview: matters, then under each matter its contacts, its role slots flattened into one row for every person named, and its assets,
// where one pointer holds an address for most labels and an account number for others. Made-up data in the shape of an estate-planning intake system's answers, no client data.
import test from "node:test";
import assert from "node:assert/strict";
import { kit } from "../fixtures/kit.ts";
import type { Probe } from "../projections.ts";

const ACCOUNT = "ACCT-000-SAMPLE-777";
const ADDRESS = "12 Sample Street, Testville, TS 00000";
const answers: Record<string, unknown> = {
  "/v1/matters": {
    count: 2,
    next: null,
    results: [
      { id: "matter_A", name: "Sample, Pat and Sam" },
      { id: "matter_B", name: "Example, Lee" },
    ],
  },
  "/v1/matters/matter_A/contacts": {
    matter: "matter_A",
    contacts: [
      {
        id: "contact_1",
        full_name: "Pat Sample",
        is_client: true,
        phone_numbers: [{ type: "mobile", number: "555 0100" }],
        addresses: [{ street: "12 Sample Street" }],
      },
      { id: "contact_2", full_name: "Sam Sample", is_client: true, phone_numbers: [], addresses: [] },
      {
        id: "contact_3",
        full_name: "Kid Sample",
        is_client: false,
        relationship: { type: "2SON", short: "Son", description: "Son" },
      },
    ],
  },
  "/v1/matters/matter_A/roles": {
    matter: "matter_A",
    roles: [
      {
        id: "role_x",
        role_description: "Successor Trustee",
        split: false,
        focus_type: null,
        focus_contact: null,
        assignments: [{ position: 1, display_name: "Kid Sample and Sam Sample", contacts: ["contact_3", "contact_2"] }],
      },
      {
        id: "role_y",
        role_description: "Medical Power of Attorney - Pat Sample",
        split: true,
        focus_type: "contact_main",
        focus_contact: "contact_1",
        assignments: [{ position: 1, display_name: "Sam Sample", contacts: ["contact_2"] }],
      },
      {
        id: "role_y",
        role_description: "Medical Power of Attorney - Sam Sample",
        split: true,
        focus_type: "contact_partner",
        focus_contact: "contact_2",
        assignments: [{ position: 1, display_name: "Pat Sample", contacts: ["contact_1"] }],
      },
      {
        id: "role_z",
        role_description: "Trustee",
        split: false,
        focus_type: null,
        focus_contact: null,
        assignments: [],
      },
    ],
  },
  "/v1/matters/matter_A/assets": {
    matter: "matter_A",
    assets: [
      {
        id: "asset_1",
        for_fin_category: "fincat_re",
        identifier_label: "Address / Description",
        identifier_value: ADDRESS,
        owner_label: "How Titled?",
        owner_value: "Jointly",
        additional_fields: [{ id: "f1", prompt: "Type", answer: "Primary residence" }],
      },
      {
        id: "asset_2",
        for_fin_category: "fincat_bank",
        identifier_label: "Account Number (last 4 digits)",
        identifier_value: ACCOUNT,
        owner_label: "Owner",
        owner_value: "Pat",
        additional_fields: [],
      },
    ],
  },
};

const SPEC = {
  app: { name: "Intake", domain: "intake.test" },
  auth: { vaultHandle: "#Intake_Key", style: "header", header: "Authorization", prefix: "Token " },
  objects: [
    {
      remote: "matters",
      label: "Matter",
      id: "/id",
      itemsAt: "/results",
      list: { path: "/v1/matters", cursor: { kind: "page", param: "page", size: 200, sizeParam: "page_size" } },
      fields: [{ path: "/name", label: "Name", type: "text" }],
    },
    {
      remote: "contacts",
      label: "Contact",
      id: "/id",
      itemsAt: "/contacts",
      list: { path: "/v1/matters/{matter}/contacts", eachOf: { object: "matters", param: "matter", scoped: false } },
      fields: [
        { path: "/full_name", label: "Full name", type: "text" },
        { path: "/phone_numbers/0/number", label: "Phone", type: "phone" },
        { path: "/_parent", label: "Matter", type: "relation", relationTo: "matters", inverseKey: "people" },
      ],
    },
    {
      remote: "roles",
      label: "Role assignment",
      id: "/_key",
      itemsAt: "/roles",
      rows: { at: "/assignments/*/contacts/*", idAt: ["/id", "/focus_contact"] },
      list: { path: "/v1/matters/{matter}/roles", eachOf: { object: "matters", param: "matter" } },
      fields: [
        { path: "/role_description", label: "Role", type: "text" },
        { path: "/_at/0/position", label: "Rank", type: "number" },
        { path: "/_i/1", label: "Place in the rank", type: "number" },
        { path: "/_at/1", label: "Person", type: "relation", relationTo: "contacts", inverseKey: "roles" },
        { path: "/_parent", label: "Matter", type: "relation", relationTo: "matters", inverseKey: "roles" },
      ],
    },
    {
      remote: "assets",
      label: "Asset",
      id: "/id",
      itemsAt: "/assets",
      list: { path: "/v1/matters/{matter}/assets", eachOf: { object: "matters", param: "matter", scoped: false } },
      fields: [
        { path: "/identifier_label", label: "Identifier is", type: "text" },
        {
          path: "/identifier_value",
          label: "Address or description",
          type: "text",
          onlyWhen: { path: "/identifier_label", matches: ["account", "policy"], not: true },
        },
        {
          path: "/identifier_value",
          key: "identifier_sealed",
          label: "Account number",
          type: "sealed",
          onlyWhen: { path: "/identifier_label", matches: ["account", "policy"] },
        },
        { path: "/additional_fields", label: "Extra answers", type: "json" },
        { path: "/_parent", label: "Matter", type: "relation", relationTo: "matters", inverseKey: "assets" },
      ],
    },
  ],
  mapping: [
    {
      remote: "matters",
      recordType: "in_matter",
      title: "Matter",
      titleField: "/name",
      fields: [{ path: "/name", field: "name", direction: "pull" }],
    },
    {
      remote: "contacts",
      recordType: "in_contact",
      title: "Contact",
      titleField: "/full_name",
      fields: [
        { path: "/full_name", field: "full_name", direction: "pull" },
        { path: "/phone_numbers/0/number", field: "phone", direction: "pull" },
        { path: "/_parent", field: "matter", direction: "pull" },
      ],
    },
    {
      remote: "roles",
      recordType: "in_assignment",
      title: "Role assignment",
      titleField: "/role_description",
      fields: [
        { path: "/role_description", field: "role", direction: "pull" },
        { path: "/_at/0/position", field: "position", direction: "pull" },
        { path: "/_i/1", field: "co_order_index", direction: "pull" },
        { path: "/_at/1", field: "person", direction: "pull" },
        { path: "/_parent", field: "matter", direction: "pull" },
      ],
    },
    {
      remote: "assets",
      recordType: "in_asset",
      title: "Asset",
      titleField: "/identifier_label",
      fields: [
        { path: "/identifier_label", field: "identifier_label", direction: "pull" },
        { path: "/identifier_value", field: "identifier", direction: "pull" },
        { path: "/identifier_value", field: "identifier_sealed", direction: "pull" },
        { path: "/additional_fields", field: "additional_fields", direction: "pull" },
        { path: "/_parent", field: "matter", direction: "pull" },
      ],
    },
  ],
  plan: {
    firstPull: { words: "Matters, their people, role assignments and assets, read only." },
    backfill: "now",
    conflicts: "newest",
  },
};

function world() {
  const k = kit();
  k.vault["#Intake_Key"] = "k-intake";
  const seen: string[] = [];
  const probe: Probe = async (_ctx, req) => {
    const u = new URL(req.url);
    seen.push(u.pathname);
    const body = answers[u.pathname];
    return { status: body === undefined ? 404 : 200, text: body === undefined ? "" : JSON.stringify(body) };
  };
  k.deps.probe = probe;
  return { k, seen };
}

test("validate reads each per-matter list under a real matter, flattens the roles and reads the conditional fields", async () => {
  const w = world();
  const v = await w.k.hs["sync_specs.validate"](w.k.ctx, { spec: SPEC });
  assert.equal(v.ok, true, JSON.stringify(v.problems.filter((p) => p.level === "error")));
  assert.ok(w.seen.includes("/v1/matters/matter_A/contacts"));
  assert.ok(w.seen.includes("/v1/matters/matter_A/roles"));
  assert.ok(w.seen.includes("/v1/matters/matter_A/assets"));
  assert.ok(!JSON.stringify(v).includes(ACCOUNT), "the account number is in nothing validate says");
});

test("preview: the roles are one row for every person named, the address is plain, the account number is only said to be there", async () => {
  const w = world();
  const p = await w.k.hs["sync_specs.preview"](w.k.ctx, { spec: SPEC });
  assert.ok(!JSON.stringify(p).includes(ACCOUNT), "the preview never holds the account number");
  const roles = p.samples.find((s) => s.type === "in_assignment")!;
  assert.ok(roles, "a sample of the role assignments");
  const val = (key: string): unknown => roles.fields.find((f) => f.key === key)!.value;
  assert.equal(val("role"), "Successor Trustee");
  assert.equal(val("position"), 1);
  assert.equal(val("co_order_index"), 0, "the first person named serves first");
  assert.equal(roles.fields.find((f) => f.key === "person")!.label, "Person");
  const assets = p.samples.find((s) => s.type === "in_asset")!;
  const sealed = assets.fields.find((f) => f.key === "identifier_sealed")!;
  assert.deepEqual(sealed.value, { sealed: true, present: false }, "the first asset is an address: nothing sealed");
  assert.equal(assets.fields.find((f) => f.key === "identifier")!.value, ADDRESS);
});

test("validate says where and changed must name mapped fields of the parent (or the feed), and accepts them when they do", async () => {
  const w = world();
  const spec = JSON.parse(JSON.stringify(SPEC));
  spec.objects[0].fields.push({ path: "/is_submitted", label: "Submitted", type: "bool" });
  spec.mapping[0].fields.push({ path: "/is_submitted", field: "is_submitted", direction: "pull" });
  spec.objects[1].list.eachOf.where = { path: "/is_submitted", equals: "true" };
  const good = await w.k.hs["sync_specs.validate"](w.k.ctx, { spec });
  assert.equal(good.ok, true, JSON.stringify(good.problems.filter((p) => p.level === "error")));
  spec.objects[1].list.eachOf.where = { path: "/not_mapped", equals: "true" };
  spec.objects[1].list.eachOf.changed = { path: "/also_not_mapped" };
  const bad = await w.k.hs["sync_specs.validate"](w.k.ctx, { spec });
  assert.equal(bad.ok, false);
  const said = bad.problems.filter((p) => p.level === "error").map((p) => p.message);
  assert.ok(
    said.some((m) => m.includes("/not_mapped must be one of matters's mapped fields")),
    said.join(" | "),
  );
  assert.ok(said.some((m) => m.includes("/also_not_mapped must be one of")));
});

test("validate refuses a version that is empty on every sampled parent, since no parent would ever look changed", async () => {
  const w = world();
  const spec = JSON.parse(JSON.stringify(SPEC));
  spec.objects[1].list.eachOf.changed = { path: "/name" };
  spec.mapping[0].fields.push({ path: "/name", field: "name2", direction: "pull" });
  const ok = await w.k.hs["sync_specs.validate"](w.k.ctx, { spec });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems.filter((p) => p.level === "error")));
  spec.objects[0].fields.push({ path: "/rev", label: "Rev", type: "text" });
  spec.mapping[0].fields.push({ path: "/rev", field: "rev", direction: "pull" });
  spec.objects[1].list.eachOf.changed = { path: "/rev" };
  const bad = await w.k.hs["sync_specs.validate"](w.k.ctx, { spec });
  assert.equal(bad.ok, false);
  assert.ok(
    bad.problems.some((p) => p.level === "error" && p.message.includes("/rev is empty on every sampled matters")),
  );
});
