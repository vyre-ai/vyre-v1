import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("PWA mobile smoke is explicitly a simulated Chromium standalone proof", () => {
  const script = fs.readFileSync(new URL("./pwa-mobile.mjs", import.meta.url), "utf8");
  assert.match(script, /iPhone-width PWA smoke/);
  assert.match(script, /standalone media query simulated/);
  assert.match(script, /setOffline\(true\)/);
  assert.match(script, /setOffline\(false\)/);
  assert.match(script, /iphone-390x844-standalone-simulated\.png/);
  assert.match(script, /vyre\.session\.v1/);
});
