import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { docMismatches, loadDeferredSet } from "./check-deferred-doc.ts";

test("deferred-doc: docs/deferred.md matches the capabilities the host defers", async () => {
  const doc = fs.readFileSync(new URL("../docs/deferred.md", import.meta.url), "utf8");
  assert.deepEqual(docMismatches(doc, await loadDeferredSet()), []);
});

test("deferred-doc: a capability missing from the doc, and one the host no longer defers, are both named", () => {
  const doc = "| Module | Capability | Packet |\n|---|---|---|\n| vault | vault.import, vault.generate | P |\n| sites | all 2 sites.* capabilities | P |\n";
  assert.deepEqual(docMismatches(doc, new Set(["vault.import", "vault.generate", "sites.a", "sites.b"])), []);
  assert.deepEqual(docMismatches(doc, new Set(["vault.import", "sites.a", "sites.b", "vault.health"])), [
    "vault.health is deferred in the host but not in docs/deferred.md",
    "vault.generate is in docs/deferred.md but not deferred in the host",
  ]);
  assert.deepEqual(docMismatches(doc, new Set(["vault.import", "vault.generate", "sites.a"])), ["docs/deferred.md says all 2 sites.* capabilities are deferred; the host defers 1"]);
});
