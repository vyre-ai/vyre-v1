// Settings, About Vyre: the version, the channel, the last check and Check now; "Update Vyre automatically", on by default; the quiet "Update available" row when a newer version waits;
// and What's new. The shell's commands themselves are tested in startup/update/store.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutBody, updateLine } from "../../places/settings/DesktopUpdate.tsx";
import type { AboutBodyProps } from "../../places/settings/DesktopUpdate.tsx";

const none = { phase: "none" as const, current: "1.0.0-rc.16", channel: "beta", version: null, notes: null, checkedAt: 0 };
const some = { phase: "available" as const, current: "1.0.0-rc.16", channel: "beta", version: "1.0.0-rc.17", notes: "Vyre updates itself.\nCalmer start.", checkedAt: 0 };
const draw = (o: Partial<AboutBodyProps>): string => renderToStaticMarkup(
  <AboutBody desktop state={{ check: none, installing: false }} webVersion={null} auto busy={false} failure="" progress={null} notes={null} now={5 * 60_000}
    onCheck={() => undefined} onInstall={() => undefined} onAuto={() => undefined} onWhatsNew={() => undefined} {...o} />,
);

test("the version row: the version, the channel, when it last checked, and Check now", () => {
  assert.equal(updateLine(null), "");
  assert.equal(updateLine(none), "Up to date");
  assert.equal(updateLine(some), "Update available 1.0.0-rc.17");
  const out = draw({});
  for (const t of ["Vyre 1.0.0-rc.16", "Beta channel. Checked 5 min ago", "Up to date", "Check now", "Update Vyre automatically"]) assert.ok(out.includes(t), t);
  assert.match(out, /data-testid="update-check"/);
  assert.doesNotMatch(out, /update-install/, "nothing to install");
  assert.match(out, /aria-checked="true"/, "on by default");
  assert.match(draw({ auto: false }), /aria-checked="false"/);
});

test("a newer version waiting: a quiet Update available row with its notes and Update now; while it installs, the progress", () => {
  const out = draw({ state: { check: some, installing: false } });
  assert.ok(out.includes("Update available") && out.includes("Vyre 1.0.0-rc.17 is ready. Vyre updates itself."));
  assert.ok(!out.includes("Update available 1.0.0-rc.17"), "said once, on its own row");
  assert.match(out, /data-testid="update-install"/);
  const going = draw({ state: { check: some, installing: true }, busy: true, progress: { phase: "download", downloaded: 1024 * 1024, total: 2 * 1024 * 1024 } });
  assert.ok(going.includes("Updating to 1.0.0-rc.17") && going.includes("1.0 MB of 2.0 MB, 50%"));
  assert.match(draw({ state: { check: some, installing: false }, failure: "The update did not install: the signature is not valid" }), /the signature is not valid/);
});

test("a check that failed says why on the version row", () => {
  assert.match(draw({ failure: "Couldn't reach the update server." }), /Couldn&#x27;t reach the update server\./);
});

test("in a browser: the version from the build and What's new, no toggle and no Check now", () => {
  const out = draw({ desktop: false, state: { check: null, installing: false }, webVersion: "1.0.0-rc.17", notes: { version: "1.0.0-rc.17", lines: ["Better."] } });
  assert.ok(out.includes("Vyre 1.0.0-rc.17") && out.includes("updates each time it opens"));
  assert.doesNotMatch(out, /update-check|update-auto/);
  assert.match(out, /data-testid="whats-new-open"/);
  assert.ok(out.includes("What got better in 1.0.0-rc.17"));
  assert.doesNotMatch(draw({ notes: { version: "1.0.0-rc.16", lines: [] } }), /whats-new-open/, "nothing to open with no lines");
  for (const o of [{}, { state: { check: some, installing: false } }]) assert.ok(!draw(o).includes("—"));
});

