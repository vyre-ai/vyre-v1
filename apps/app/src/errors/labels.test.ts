// The menu entry that copies an error's trace id reads "Copy error details" everywhere (the copied text may still hold the trace id). "Trace" is not a word a person is asked to know.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = ["places/chats/conversation/MessageView.tsx", "places/automations/config/RunsTab.tsx", "places/automations/runs/actions.tsx"];

test("the error menus say Copy error details, not Copy Trace Id", () => {
  for (const f of FILES) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(text.includes('label: "Copy error details"'), `${f} offers Copy error details`);
    assert.ok(!text.includes("Copy Trace Id"), `${f} no longer says Copy Trace Id`);
  }
});
