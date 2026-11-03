// A Claude Code sign-in taken from this computer is kept as its files (owner decision D2, 3 Nov 2026): it travels to the engine like Codex's, through VYRE_CRED_FILES into the engine's
// config folder. A setup token, when the item has one, still wins, and a ref that names its field is taken as it is.
import test from "node:test";
import assert from "node:assert/strict";
import { CRED_FILES_ENV, claudeSigninSlot, cliCredential } from "../src/drivers/open/credentials.ts";

test("the files slot is used only when the item has no setup token and does have the files", async () => {
  const slot = cliCredential("claude_code", "subscription", "#Maya_Claude")!;
  assert.deepEqual(slot, { env: "CLAUDE_CODE_OAUTH_TOKEN", handle: "#Maya_Claude.setup_token" });
  const has = (fields: string[]) => async (h: string) => fields.some((f) => h === `#Maya_Claude.${f}`);
  assert.deepEqual(await claudeSigninSlot(slot, "#Maya_Claude", has(["credentials"])), { env: CRED_FILES_ENV, handle: "#Maya_Claude.credentials" });
  assert.deepEqual(await claudeSigninSlot(slot, "#Maya_Claude", has(["setup_token", "credentials"])), slot, "a setup token wins");
  assert.deepEqual(await claudeSigninSlot(slot, "#Maya_Claude", has([])), slot, "nothing there: the old slot, which then says the key is missing");
  const named = cliCredential("claude_code", "subscription", "#Maya_Claude.setup_token")!;
  let asked = 0;
  assert.deepEqual(await claudeSigninSlot(named, "#Maya_Claude.setup_token", async () => { asked++; return false; }), named);
  assert.equal(asked, 0, "a ref that names its field is not looked up");
});
