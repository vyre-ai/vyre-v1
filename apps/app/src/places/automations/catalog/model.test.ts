import test from "node:test";
import assert from "node:assert/strict";
import { groupFor, menuGroups } from "./model.ts";

test("first-party steps land in Vyre or Connected apps, with common operations before the authenticated request", () => {
  assert.equal(groupFor({ key: "google.gmail.list_messages", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "ms.drive.list_items", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "github.issue.create", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "connector_request", category: "data" }), "Connected apps");
  assert.equal(groupFor({ key: "files.list", category: "data" }), "Vyre");
  assert.equal(groupFor({ key: "calendar.create_event", category: "send" }), "Vyre");
  assert.equal(groupFor({ key: "forms.publish", category: "send" }), "Vyre");
  assert.equal(groupFor({ key: "records.find", category: "data" }), "Data & transforms");
  assert.equal(groupFor({ key: "ai", category: "ai" }), "Preview");
  const menu = menuGroups([
    { key: "connector_request", group: "Connected apps", title: "Authenticated request" },
    { key: "google.gmail.send_message", group: "Connected apps", title: "Google · Send a Gmail message" },
    { key: "google.gmail.list_messages", group: "Connected apps", title: "Google · List Gmail messages" },
  ]);
  assert.deepEqual(menu[0]!.items.map((item) => item.key), ["google.gmail.list_messages", "google.gmail.send_message", "connector_request"]);
});
