// The no-dead-buttons gate (scripts/click/dead-buttons.mjs). The pure parts always run; the click-through needs the production web export (VYRE_APP_DIST) and WebKit, and runs in the shots workflow's release-evidence job.
import test from "node:test";
import assert from "node:assert/strict";
import { screenKey, tauriCsp, untouchedDirectives, deadKey, main, rescue, rescued } from "./dead-buttons.mjs";

test("dead-buttons: ids in a screen hash collapse, so one record stands for every record", () => {
  assert.equal(
    screenKey("http://x/records#subject=record:rec_ab12cd34&type=project"),
    "/records#subject=record:*&type=project",
  );
  assert.equal(
    screenKey("http://x/settings#screen=settings.page&page=profile"),
    "/settings#screen=settings.page&page=profile",
  );
  assert.equal(screenKey("http://x/home"), "/home");
});

test("dead-buttons: the CSP under test is the desktop app's: Tauri's nonce goes only into the directives tauri.conf.json does not exempt", () => {
  const csp = tauriCsp("abc123");
  const kept = untouchedDirectives();
  assert.match(csp, /default-src 'self' ipc:/);
  for (const d of ["style-src", "script-src"]) {
    const line =
      csp
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(`${d} `)) ?? "";
    if (kept.includes(d))
      assert.ok(!line.includes("nonce-") && line.includes("'unsafe-inline'"), `${d} is left as written`);
    else
      assert.ok(
        line.includes("'nonce-abc123'") && !line.includes("'unsafe-inline'"),
        `${d} gets the nonce and loses unsafe-inline`,
      );
  }
});

test("dead-buttons: a dead element has one baseline key per space, place, screen, path and selector", () => {
  const d = {
    space: "team",
    place: "vault",
    screen: "/vault",
    path: ["Add"],
    label: "Add to the Vault",
    selector: "div > button",
  };
  assert.equal(deadKey(d), "team|vault|/vault|Add|Add to the Vault|div > button");
});

test("dead-buttons: every button in the real app on WebKit under the desktop CSP does something (baseline: scripts/click/dead-baseline.json)", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    t.skip("VYRE_APP_DIST is not set: the shots workflow runs this after the production export");
    return;
  }
  const code = await main([
    "--dist",
    dist,
    "--browser",
    process.env["VYRE_CLICK_BROWSER"] ?? "webkit",
    "--csp",
    process.env["VYRE_CLICK_CSP"] ?? "tauri",
    "--out",
    process.env["VYRE_CLICK_OUT"] ?? "shots-evidence/dead-buttons",
  ]);
  assert.equal(code, 0, "a new dead button, or the gate could not run; see the report in shots-evidence/dead-buttons");
});

// 14 Nov 2026 (F32): the checker measured buttons under a layer its own earlier click had opened and called them unreachable. It may look again after Escape, but only for that, and a layer that stays is a finding.
function fakeWorld(first: Record<string, unknown>, after: Record<string, unknown>) {
  let n = 0;
  const keys: string[] = [];
  const page = {
    evaluate: async () => (n++ === 0 ? after : after),
    keyboard: { press: async (k: string) => void keys.push(k) },
    getByTestId: () => ({ or: () => ({ first: () => ({ waitFor: async () => undefined }) }) }),
  };
  return { w: { page, clicksSinceLoad: 1 } as never, keys, first };
}
test("dead-buttons: a button behind a layer the checker's own click opened is pressed after Escape, and counted", async () => {
  const before = rescued.layers;
  const f = fakeWorld({}, { x: 10, y: 10 });
  const r = await rescue(f.w, { i: 1, label: "Projects" }, { x: null, layer: true, shell: true, cover: "div" });
  assert.equal(r.pt.x, 10);
  assert.deepEqual(f.keys, ["Escape"]);
  assert.equal(rescued.layers, before + 1);
});
test("dead-buttons: a layer that stays after Escape, or covers a fresh page, is a stuck layer; a tab strip is not rescued", async () => {
  const stays = fakeWorld({}, { x: null, layer: true, shell: true, cover: "div" });
  assert.match(
    (await rescue(stays.w, { i: 1, label: "A" }, { x: null, layer: true, shell: true, cover: "div" })).pt
      .stuck as string,
    /stays after Escape/,
  );
  const fresh = fakeWorld({}, {});
  (fresh.w as { clicksSinceLoad: number }).clicksSinceLoad = 0;
  const r = await rescue(fresh.w, { i: 1, label: "A" }, { x: null, layer: true, shell: true, cover: "div" });
  assert.match(r.pt.stuck as string, /nothing was opened/);
  assert.deepEqual(fresh.keys, [], "no Escape on a fresh page");
  const strip = fakeWorld({}, {});
  const s = await rescue(
    strip.w,
    { i: 1, label: "Upload files" },
    { x: null, layer: false, shell: true, cover: "div[data-testid=tab-strip] Chats" },
  );
  assert.equal(s.pt.x, null);
  assert.deepEqual(strip.keys, [], "something that stays is never rescued");
});
