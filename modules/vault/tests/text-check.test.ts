// vault.text_check (lane l-agentdm): which of the person's own Mine items have a value in a text, by handle only, before an agent's words go to a teammate. Shared items and other people's are not
// the question; a locked key says it could not check.
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import { textCheck } from "../handlers/text-check.ts";
import { MAYA, SECRET, harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;

test("a Mine value in the text is named by its handle, never echoed; nothing found is an empty list; a locked key says so", async () => {
  const h = harness();
  const folderId = String(out(out(await v.foldersCreate(h.ctx, { name: "My keys", scope: "mine", idempotencyKey: "tc-f" })).folder).id);
  await v.itemPut(h.ctx, { folderId, name: "Dana Lawmatics", kind: "api_key", fields: [{ key: "username", value: "dana" }, { key: "api_key", value: SECRET }], idempotencyKey: "tc-p" } as Parameters<typeof v.itemPut>[1]);
  const hit = await textCheck(h.ctx, { text: `Here it is: ${SECRET}` });
  assert.deepEqual(hit, { handles: ["#Dana_Lawmatics"], checked: true });
  assert.ok(!JSON.stringify(hit).includes(SECRET));
  assert.deepEqual(await textCheck(h.ctx, { text: "Nothing secret here." }), { handles: [], checked: true });
  h.lock(MAYA);
  assert.deepEqual(await textCheck(h.ctx, { text: SECRET }), { handles: [], checked: false });
});
