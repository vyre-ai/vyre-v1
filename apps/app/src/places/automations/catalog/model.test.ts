import test from "node:test";
import assert from "node:assert/strict";
import { connectorSteps, groupFor, loadProductCatalog, menuGroups, unlistedAppLine } from "./model.ts";
import { withPreset } from "../canvas/model.ts";

test("first-party steps land in Vyre or Connected apps, with common operations before the authenticated request", () => {
  assert.equal(groupFor({ key: "google.gmail.list_messages", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "ms.drive.list_items", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "github.issue.create", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "connector_request", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "files.list", category: "data" }), "Vyre");
  assert.equal(groupFor({ key: "calendar.create_event", category: "send" }), "Vyre");
  assert.equal(groupFor({ key: "forms.publish", category: "send" }), "Vyre");
  assert.equal(groupFor({ key: "records.find", category: "data" }), "Data & transforms");
  assert.equal(groupFor({ key: "parallel", category: "control" }), "Logic");
  const menu = menuGroups([
    { key: "connector_request", group: "Connected apps", title: "Authenticated request" },
    { key: "google.gmail.send_message", group: "Connected apps", title: "Google · Send a Gmail message" },
    { key: "google.gmail.list_messages", group: "Connected apps", title: "Google · List Gmail messages" },
  ]);
  assert.deepEqual(
    menu[0]!.items.map((item) => item.key),
    ["google.gmail.list_messages", "google.gmail.send_message", "connector_request"],
  );
});

const live = {
  connectors: [
    { key: "acme", title: "Acme", builtin: false, state: "live", actions: ["list_invoices", "create-invoice"] },
    { key: "google", title: "Google", builtin: true, state: "live", actions: ["gmail.list"] },
    { key: "draftco", title: "Draft Co", builtin: false, state: "draft", actions: ["ping"] },
    { key: "lonely", title: "Lonely", builtin: false, state: "live", actions: ["ping"] },
  ],
};
const connections = {
  connections: [
    { connectionId: "con_acme", connector: "acme", state: "active" },
    { connectionId: "con_old", connector: "lonely", state: "needs_reconnect" },
    { connectionId: "con_g", connector: "google", state: "active" },
  ],
};

test("a connector someone built lists one step per action under Your connectors, bound to its active connection", () => {
  const steps = connectorSteps(live, connections);
  assert.deepEqual(
    steps.map((s) => [s.title, s.group, s.key]),
    [
      ["Acme: List invoices", "Your connectors", "connector_request"],
      ["Acme: Create invoice", "Your connectors", "connector_request"],
    ],
  );
  assert.deepEqual(steps[0]!.preset, { connector: "acme", action: "list_invoices", connectionId: "con_acme" });
  assert.deepEqual(connectorSteps(null, null), []);
  assert.deepEqual(connectorSteps({ connectors: "x" }, connections), []);
});

test("Your connectors sits after Vyre and before Connected apps, and picking a connector step fills its input", () => {
  const groups = menuGroups([{ group: "Connected apps" }, { group: "Your connectors" }, { group: "Vyre" }]).map(
    (g) => g.head,
  );
  assert.deepEqual(groups, ["Vyre", "Your connectors", "Connected apps"]);
  const def = { triggers: [{ key: "manual" }], nodes: [{ id: "n1", key: "connector_request", input: {} }] };
  assert.deepEqual(
    withPreset(def, "n1", { connector: "acme", action: "list_invoices", connectionId: "con_acme" }).nodes[0]!.input,
    { connector: "acme", action: "list_invoices", connectionId: "con_acme" },
  );
  assert.equal(withPreset(def, "n1", undefined), def);
});

test("the catalog loads the built connectors beside the palette, and without them it is the palette", async () => {
  const steps = { steps: [{ key: "http_request", title: "HTTP request", category: "data" }] };
  const triggers = { triggers: [{ key: "manual", title: "Manual" }] };
  const withBuilt = await loadProductCatalog(async (cap) =>
    cap === "automations.steps.list"
      ? steps
      : cap === "automations.triggers.list"
        ? triggers
        : cap === "connectors.list"
          ? live
          : connections,
  );
  assert.ok(withBuilt.ok && withBuilt.catalog.steps.length === 3);
  const without = await loadProductCatalog(async (cap) => {
    if (cap.startsWith("connect")) throw new Error("no access");
    return cap === "automations.steps.list" ? steps : triggers;
  });
  assert.ok(without.ok && without.catalog.steps.length === 1);
});

test("an action nobody tried against the real app is marked untested, and with no levels nothing is claimed", () => {
  const levels = {
    levels: [
      { actionKey: "acme.list_invoices", level: "tested" },
      { actionKey: "acme.create-invoice", level: "draft" },
    ],
  };
  const marked = connectorSteps(live, connections, levels).map((s) => [s.title, s.untested === true]);
  assert.deepEqual(marked, [
    ["Acme: List invoices", false],
    ["Acme: Create invoice", true],
  ]);
  assert.ok(connectorSteps(live, connections).every((s) => s.untested === undefined));
});

test("an existing step whose app is not listed keeps its form (all) and gets one plain line; the menu list is unchanged, and a failing full read falls back to the menu list", async () => {
  const listed = { steps: [{ key: "http_request", title: "HTTP request", category: "data" }] };
  const every = {
    steps: [
      { key: "http_request", title: "HTTP request", category: "data" },
      {
        key: "ms.mail.send_message",
        title: "Microsoft · Send an Outlook message",
        category: "send",
        input: { required: ["to"] },
      },
    ],
  };
  const triggers = { triggers: [{ key: "manual", title: "Manual" }] };
  const res = await loadProductCatalog(async (cap, input) =>
    cap === "automations.steps.list"
      ? (input as { all?: boolean }).all
        ? every
        : listed
      : cap === "automations.triggers.list"
        ? triggers
        : { connectors: [], connections: [] },
  );
  assert.ok(res.ok);
  if (res.ok) {
    assert.deepEqual(
      res.catalog.steps.map((s) => s.key),
      ["http_request"],
    );
    assert.ok(res.catalog.all.some((s) => s.key === "ms.mail.send_message"));
    const keys = new Set(res.catalog.steps.map((s) => s.key));
    assert.equal(unlistedAppLine("ms.mail.send_message", keys), "Uses Microsoft 365, which you have not been given.");
    assert.equal(unlistedAppLine("http_request", keys), null);
    assert.equal(
      unlistedAppLine("ms.mail.send_message", keys, false),
      "Could not check your apps. Try again.",
      "a failed read blames nothing on the person",
    );
    assert.equal(res.catalog.checked, true);
  }
  const failed = await loadProductCatalog(async (cap, input) => {
    if (cap === "automations.steps.list" && (input as { all?: boolean }).all) throw new Error("no");
    return cap === "automations.steps.list"
      ? listed
      : cap === "automations.triggers.list"
        ? triggers
        : { connectors: [], connections: [] };
  });
  assert.ok(failed.ok && failed.catalog.all.length === 1);
});

test("the catalogue knows when the connected apps could not be read (checked false), and says so instead of blaming the person", async () => {
  const triggers = { triggers: [{ key: "manual", title: "Manual" }] };
  const out = await loadProductCatalog(async (cap) =>
    cap === "automations.steps.list"
      ? { steps: [{ key: "http_request", title: "HTTP request", category: "data" }], checked: false }
      : cap === "automations.triggers.list"
        ? triggers
        : { connectors: [], connections: [] },
  );
  assert.ok(out.ok && out.catalog.checked === false);
});
