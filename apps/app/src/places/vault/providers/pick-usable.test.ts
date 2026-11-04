import test from "node:test";
import assert from "node:assert/strict";
import { aiOptions } from "./pick.ts";
import type { PickRow } from "./pick.ts";

const row = (o: Partial<PickRow> & { id: string }): PickRow => ({ name: o.id, scope: "shared", handle: `#${o.id}`, state: "ok", ...o });

test("the Space AI pickers offer what the resolver says can run the work, and a capped account that is kept for it; nothing else", () => {
  const rows = [
    row({ id: "Auto", usableIn: { automations: { usable: true }, agentWork: { usable: false, code: "not_used_for" }, chats: { usable: true } } }),
    row({ id: "Capped", capped: true, usableIn: { automations: { usable: false, code: "capped" }, agentWork: { usable: false, code: "not_used_for" } } }),
    row({ id: "Chats", usableIn: { automations: { usable: false, code: "not_used_for" }, chats: { usable: true } } }),
    row({ id: "Gone", state: "needs_sign_in", usableIn: { automations: { usable: false, code: "expired" } } }),
    row({ id: "Plain", uses: { automations: true } }),
  ];
  assert.deepEqual(aiOptions(rows, "automations").map((o) => o.value), ["", "#Auto", "#Capped", "#Plain"], "Plain has no resolver answer: its own uses decide, as before");
  assert.deepEqual(aiOptions(rows, "chats").map((o) => o.value), ["", "#Auto", "#Capped", "#Chats", "#Plain"], "a row with no chat answer keeps the Chat key rule: any Space account that works");
  assert.deepEqual(aiOptions(rows, "agentWork").map((o) => o.value), [""]);
  assert.equal(aiOptions(rows, "automations").find((o) => o.value === "#Capped")?.capped, true);
});
