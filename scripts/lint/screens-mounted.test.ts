// screens-mounted (P-CI_70): a fixture with an unmounted component and an unresolved screen id fails when enforced; a mounted one passes; the allowlist accepts a known gap and reports a stale
// entry; and the real repo is read in report mode, printing every gap for the lead's list without failing the build.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENFORCE, checkMounted, judge, readAllowlist, readRepo, report } from "./screens-mounted.ts";
import type { Allowlist, MountedInput } from "./screens-mounted.ts";

const none: Allowlist = { screens: [], probeScreens: [], openTargets: [], components: [] };

const world = (over: Record<string, string> = {}): MountedInput => ({
  screens: { "chats.sidebar": "chats", "files.list": "files", "shell.cmdk": "shell" },
  probeScreens: ["chats.sidebar"],
  shellPlaces: ["shell", "chats", "files"],
  files: {
    "apps/app/src/places/chats/sidebar/ChatsSidebar.tsx": `export const SIDEBAR_SCREEN = "chats.sidebar";`,
    "apps/app/src/places/chats/sidebar/ChatsSidebar.test.tsx": `import "./ChatsSidebar.tsx";`,
    "apps/app/src/shell/providers/chats.tsx": `import { X } from "../../places/chats/sidebar/ChatsSidebar.tsx"; rt.open({ screen: "files.list" });`,
    "ui/src/Row/index.tsx": `export const Row = 1;`,
    "ui/src/Row/Row.test.tsx": `import "./index.tsx";`,
    "apps/app/src/places/files/list/FilesList.tsx": `export const SCREEN = "files.list";`,
    ...over,
  },
});

test("a mounted world has no gaps", () => {
  const gaps = checkMounted(world({
    "apps/app/src/shell/cmdk/Cmdk.tsx": `export const CMDK_SCREEN = "shell.cmdk";`,
    "apps/app/src/places/files/list/FilesList.tsx": `import { Row } from "../../../../../../ui/src/Row/index.tsx"; export const SCREEN = "files.list";`,
  }));
  assert.deepEqual(gaps, { unmountedScreens: [], badProbeScreens: [], unmountedOpenTargets: [], unmountedComponents: [] });
});

test("an unresolved screen id fails when enforced: a registry screen drawn nowhere, a probe for a screen that does not exist, an open that reaches nothing", () => {
  const w = world({
    "apps/app/src/shell/providers/x.tsx": `rt.open({ screen: "nowhere.screen" }); rt.open({ screen: "shell.cmdk" });`,
  });
  const gaps = checkMounted({ ...w, probeScreens: ["chats.sidebar", "ghost.probe"] });
  assert.deepEqual(gaps.unmountedScreens, ["shell.cmdk"], "the registry has shell.cmdk but no product code draws it; an open call does not count");
  assert.deepEqual(gaps.badProbeScreens, ["ghost.probe"]);
  assert.deepEqual(gaps.unmountedOpenTargets, ["nowhere.screen", "shell.cmdk"]);
  const { fresh } = judge(gaps, none);
  assert.ok(fresh.length >= 4, "all of it is a failure when enforced");
});

test("an unmounted component fails when enforced: a tested directory no product code outside it imports", () => {
  const gaps = checkMounted(world());
  assert.deepEqual(gaps.unmountedComponents, ["ui/src/Row"], "Row has tests and nobody outside imports it");
  assert.ok(judge(gaps, none).fresh.includes("components: ui/src/Row"));
  const mounted = checkMounted(world({ "apps/app/src/places/files/list/FilesList.tsx": `import { Row } from "../../../../../../ui/src/Row/index.tsx"; export const SCREEN = "files.list";` }));
  assert.deepEqual(mounted.unmountedComponents, []);
});

test("a test, a sample and a fixture never count as mounting", () => {
  const w = world({
    "apps/app/src/places/files/list/FilesList.tsx": `export const nothing = 1;`,
    "apps/app/src/places/files/list/sample.ts": `export const s = "files.list";`,
    "apps/app/src/places/files/list/FilesList.test.tsx": `const s = "files.list";`,
  });
  assert.ok(checkMounted(w).unmountedScreens.includes("files.list"));
});

test("the allowlist accepts a known gap and reports an entry that is no longer a gap", () => {
  const gaps = checkMounted(world());
  const allow: Allowlist = { ...none, components: ["ui/src/Row"], screens: ["gone.screen"] };
  const { fresh, stale } = judge(gaps, allow);
  assert.ok(!fresh.includes("components: ui/src/Row"));
  assert.deepEqual(stale, ["screens: gone.screen"]);
});

test("the real repo: every gap is listed in the log; the build fails only once ENFORCE is on and a gap is not allowlisted", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const gaps = checkMounted(await readRepo(root));
  const allow = readAllowlist(root);
  const lines = report(gaps, allow);
  for (const l of lines) console.log(l);
  assert.match(lines[0] as string, /^screens-mounted: \d+ unmounted screens/);
  const { fresh } = judge(gaps, allow);
  if (ENFORCE) assert.deepEqual(fresh, [], "a gap is not allowlisted");
});
