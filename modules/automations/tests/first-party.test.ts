// First-party catalogue steps exist only where a handler already exists.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { admit, contractOf } from "../val.ts";

const LIVE = [
  "records.relate",
  "google.gmail.list_messages", "google.gmail.send_message", "google.calendar.list_events", "google.calendar.create_event",
  "google.drive.list_files", "google.drive.create_folder", "google.sheets.get_values", "google.sheets.append_values", "google.docs.create_document",
  "ms.mail.list_messages", "ms.mail.send_message", "ms.calendar.list_events", "ms.calendar.create_event", "ms.drive.list_items", "ms.drive.create_folder",
  "calendar.list_events", "calendar.create_event",
  "files.list", "files.get", "files.create", "files.move", "files.copy", "files.share",
  "github.repos.list", "github.pull_request.get", "github.issue.create", "github.issue.comment", "github.issue.assign_agent",
  "forms.list", "forms.create", "forms.publish",
];

const ABSENT = ["google.docs.batch_update", "vault.item.reveal", "records.reveal", "github.installation_token", "ms.word", "ms.excel"];

test("first-party steps admit, and actions without an automation step stay off the catalogue", () => {
  const keys = new Set(registry.steps.map((step) => step.key));
  for (const key of LIVE) {
    assert.equal(keys.has(key), true, key);
    const step = registry.steps.find((item) => item.key === key)!;
    const verdict = admit(contractOf(step, "live"));
    assert.equal(verdict.stable, true, `${key}: ${verdict.issues.map((item) => item.message).join("; ")}`);
    assert.equal(JSON.stringify(step.output).match(/secret|password|authorization|cookie|token|api[-_]?key|credential/i), null, key);
  }
  for (const key of ABSENT) assert.equal(keys.has(key), false, key);
});
