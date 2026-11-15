import test from "node:test";
import assert from "node:assert/strict";
import { pickInFromCatalog } from "./from-catalog.ts";

const steps = [
  { key: "send_email", title: "Send an email", category: "send", group: "Vyre", availability: "available" as const },
  {
    key: "google.gmail.send_message",
    title: "Google · Send a Gmail message",
    category: "send",
    group: "Connected apps",
    availability: "available" as const,
  },
  {
    key: "connector_request",
    title: "Acme: List invoices",
    category: "send",
    group: "Your connectors",
    availability: "available" as const,
    preset: { connector: "acme", action: "list_invoices" },
  },
  {
    key: "http_request",
    title: "HTTP request",
    category: "data",
    group: "Connected apps",
    availability: "available" as const,
  },
];

test("the picker's steps and apps come only from what the server listed: an app with no listed step is not an app", () => {
  const m = pickInFromCatalog(steps);
  assert.deepEqual(
    m.apps.map((a) => [a.id, a.name, a.connected, a.mayUse]),
    [
      ["google", "Google Workspace", true, true],
      ["acme", "Acme", true, true],
    ],
  );
  assert.deepEqual(
    m.steps.map((s) => s.key),
    ["send_email", "google.gmail.send_message", "connector_request", "http_request"],
  );
  assert.equal(m.steps[1]!.title, "Send a Gmail message", "the app's name is not repeated in each action");
  assert.equal(m.steps[2]!.title, "List invoices");
  assert.deepEqual(m.steps[2]!.preset, { connector: "acme", action: "list_invoices" });
});
