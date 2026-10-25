// The Files tree and the Records tables are what the prototype's own seed code builds (run in a vm by scripts/shots/gen-prototype-seed.mjs), for all three Spaces.
// prototype-seed.generated.json is written by the CI regen job from that script and committed; this test runs the script again and compares, so a prototype change that is not regenerated fails here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { OUT, runSeed } from "../../../../scripts/shots/gen-prototype-seed.mjs";

const committed = (): Record<string, { files: { N: Record<string, { name: string; dir: boolean }>; HOME_ID: string }; records: { TY: Record<string, { rows?: unknown[]; n: string }> } }> => {
  assert.ok(fs.existsSync(OUT), `run node scripts/shots/gen-prototype-seed.mjs --write (the CI regen job does) to write ${fileURLToPath(new URL(`file://${OUT}`))}`);
  return JSON.parse(fs.readFileSync(OUT, "utf8"));
};

test("the committed seed is exactly what the prototype's own code builds now", () => {
  assert.deepEqual(committed(), runSeed());
});

test("the Files tree of each Space has its home folder and its sidebar roots, and Northwind has the Rivera project", () => {
  const s = committed();
  for (const key of ["nw", "hb", "me"]) {
    const f = s[key]!.files;
    assert.ok(f.N[f.HOME_ID], `${key}: the home folder is in the tree`);
    assert.ok(Object.keys(f.N).length > 5, `${key}: a tree`);
  }
  assert.equal(s["hb"]!.files.N["hb-voss"]?.name, "Voss Ceramics");
  assert.equal(s["me"]!.files.N["pc-docs"]?.name, "Documents");
});

test("the Records tables include the synced and site tables the sidebar shows", () => {
  const ty = committed()["nw"]!.records.TY;
  for (const id of ["clients", "projects", "invoices", "meetings", "tasks", "hscontacts", "hsdeals"]) assert.ok(ty[id], id);
  assert.equal(ty["clients"]!.rows?.length, 1240);
  assert.equal(ty["hscontacts"]!.n, "HubSpot Contacts");
});
