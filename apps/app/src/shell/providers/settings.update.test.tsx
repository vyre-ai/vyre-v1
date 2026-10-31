import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { desktopUpdater } from "./settings.tsx";
import { DesktopUpdateBody, updateLine } from "../../places/settings/DesktopUpdate.tsx";

test("the desktop shell gives Settings two fixed update commands and a browser gives none", async () => {
  assert.equal(desktopUpdater(undefined), undefined);
  const calls: Array<[string, unknown]> = [];
  const u = desktopUpdater(async (command, args) => { calls.push([command, args]); return command === "check_desktop_update" ? { current: "1.0.0-rc.3", channel: "beta", version: "1.0.0-rc.4", notes: "Vyre 1.0.0-rc.4" } : undefined; })!;
  assert.deepEqual(await u.check(), { current: "1.0.0-rc.3", channel: "beta", version: "1.0.0-rc.4", notes: "Vyre 1.0.0-rc.4" });
  await u.install();
  assert.deepEqual(calls, [["check_desktop_update", undefined], ["install_desktop_update", undefined]], "the page passes the shell nothing");
  assert.deepEqual(await desktopUpdater(async () => ({ current: "1.0.0", channel: "stable" }))!.check(), { current: "1.0.0", channel: "stable", version: null, notes: null });
  await assert.rejects(() => desktopUpdater(async () => ({}))!.check(), /could not read/);
  await assert.rejects(() => desktopUpdater(async () => { throw "Couldn’t reach the update server. Check your connection and try again."; })!.check(), /reach the update server/);
});

test("the update section says what was found and offers the one next step", () => {
  const none = { current: "1.0.0-rc.3", channel: "beta", version: null, notes: null };
  const some = { current: "1.0.0-rc.3", channel: "beta", version: "1.0.0-rc.4", notes: "Fixes the first-run checklist" };
  assert.equal(updateLine(null), "");
  assert.equal(updateLine(none), "Up to date");
  assert.equal(updateLine(some), "Update available 1.0.0-rc.4");
  const draw = (o: Partial<Parameters<typeof DesktopUpdateBody>[0]>): string => renderToStaticMarkup(<DesktopUpdateBody found={null} busy={false} failure="" installing={false} onCheck={() => undefined} onInstall={() => undefined} {...o} />);
  assert.match(draw({}), /data-testid="update-check"/);
  assert.doesNotMatch(draw({}), /update-install/);
  const ready = draw({ found: some });
  assert.match(ready, /data-testid="update-install"/);
  assert.doesNotMatch(ready, /update-check/);
  assert.match(ready, /Fixes the first-run checklist/);
  assert.match(draw({ found: none }), /Up to date/);
  assert.match(draw({ found: none }), /Vyre 1\.0\.0-rc\.3/);
  assert.doesNotMatch(draw({ found: none }), /updates itself|Nothing installs until/);
  assert.match(draw({ found: some, installing: true, busy: true }), /Vyre will restart/);
  assert.match(draw({ failure: "Couldn’t reach the update server." }), /role="alert"/);
});
