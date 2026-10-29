import test from "node:test";
import assert from "node:assert/strict";
import { installKit, listKits, sheetFor, sheetLine } from "./kit-pick.ts";
import type { CapCall } from "../shell/session/caps.ts";

const fake = (answers: Record<string, unknown>) => { const calls: Array<[string, unknown]> = []; return { calls, call: (async (c: string, i: unknown) => { calls.push([c, i]); return answers[c]; }) as unknown as CapCall }; };

test("Kits are listed by the names the Kits give, the sheet is counted, and install then choose for the Space", async () => {
  const f = fake({
    "kits.list": { kits: [{ kitId: "kit_a", key: "a", title: "Alpha", version: "1", channel: "stable", installed: false, contents: [] }] },
    "kits.install_sheet": { sheet: { tools: ["x", "y"], recordTypes: ["r"], networkDomains: [], vaultNames: ["K"], scripts: 1, problems: [] } },
  });
  assert.deepEqual(await listKits(f.call), [{ kitId: "kit_a", title: "Alpha", installed: false }]);
  const sheet = await sheetFor(f.call, "kit_a");
  assert.deepEqual(sheet, { tools: 2, recordTypes: 1, networkDomains: 0, vaultNames: 1, scripts: 1, problems: 0 });
  assert.match(sheetLine(sheet), /2 tools and 1 record types.*1 Vault names.*1 scripts/);
  await installKit(f.call, "kit_a");
  assert.deepEqual(f.calls.slice(-2), [["kits.install", { kitId: "kit_a", accepted: true }], ["kits.choose", { kitId: "kit_a", scope: "space" }]]);
});
