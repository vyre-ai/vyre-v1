// The no-dead-buttons gate (scripts/click/dead-buttons.mjs). The pure parts always run; the click-through needs the production web export (VYRE_APP_DIST) and WebKit, and runs in the shots workflow's release-evidence job.
import test from "node:test";
import assert from "node:assert/strict";
import { screenKey, tauriCsp, deadKey, main } from "./dead-buttons.mjs";

test("dead-buttons: ids in a screen hash collapse, so one record stands for every record", () => {
  assert.equal(screenKey("http://x/records#subject=record:rec_ab12cd34&type=project"), "/records#subject=record:*&type=project");
  assert.equal(screenKey("http://x/settings#screen=settings.page&page=profile"), "/settings#screen=settings.page&page=profile");
  assert.equal(screenKey("http://x/home"), "/home");
});

test("dead-buttons: the CSP under test is the desktop app's, with Tauri's nonce and without the 'unsafe-inline' a nonce cancels", () => {
  const csp = tauriCsp("abc123");
  assert.match(csp, /style-src 'self' 'nonce-abc123'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' 'nonce-abc123'/);
  assert.ok(!/style-src[^;]*unsafe-inline/.test(csp));
  assert.match(csp, /default-src 'self' ipc:/);
});

test("dead-buttons: a dead element has one baseline key per space, place, screen, path and selector", () => {
  const d = { space: "team", place: "vault", screen: "/vault", path: ["Add"], label: "Add to the Vault", selector: "div > button" };
  assert.equal(deadKey(d), "team|vault|/vault|Add|Add to the Vault|div > button");
});

test("dead-buttons: every button in the real app on WebKit under the desktop CSP does something (baseline: scripts/click/dead-baseline.json)", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is not set: the shots workflow runs this after the production export"); return; }
  const code = await main(["--dist", dist, "--browser", process.env["VYRE_CLICK_BROWSER"] ?? "webkit", "--csp", process.env["VYRE_CLICK_CSP"] ?? "tauri", "--out", process.env["VYRE_CLICK_OUT"] ?? "shots-evidence/dead-buttons"]);
  assert.equal(code, 0, "a new dead button, or the gate could not run; see the report in shots-evidence/dead-buttons");
});
