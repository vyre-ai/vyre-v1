// A class of bug in setup: a style key written twice in one sheet keeps only the last, so a helper line lost its colour token and rendered dark ink on the dark card. No setup
// sheet may repeat a key, and every quiet line in setup takes its colour from a token.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  ...fs.readdirSync(HERE).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => path.join(HERE, f)),
  path.join(HERE, "../ai-signin/SignInPanel.tsx"),
  path.join(HERE, "../console/pages/SpaceKey.tsx"),
];

test("no style sheet in setup writes a key twice", () => {
  const twice: string[] = [];
  for (const f of FILES) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/StyleSheet\.create\(\{([\s\S]*?)\n\}\);/g)) {
      const keys = [...m[1]!.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((k) => k[1]!);
      for (const k of new Set(keys)) if (keys.filter((x) => x === k).length > 1) twice.push(`${path.basename(f)}: ${k}`);
    }
  }
  assert.deepEqual(twice, []);
});

test("the Vault line under the key field has a quiet ink token, not the default ink", async () => {
  const src = fs.readFileSync(path.join(HERE, "ConnectAiCard.tsx"), "utf8");
  assert.match(src, /testID="ai-key-note" style=\{s\.dim\}/);
  assert.match(src, /\n {2}dim: \{[^}]*color: "var\(--ink-3\)"/);
});
