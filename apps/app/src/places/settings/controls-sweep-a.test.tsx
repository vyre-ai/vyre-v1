// Sweep: every control with a test id on these pages is pressed once, in one mounted page, as an Owner and as a Member; none may throw. (The ones that write are asserted in controls.test.tsx.)
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { createSampleSettings, harbor, northwind } from "./sample.ts";

interface N { props: Record<string, unknown>; children?: (N | string)[] }
const pressables = (n: N, out: Map<string, N> = new Map()): string[] => {
  const id = (n.props?.["data-testid"] ?? n.props?.testID) as string | undefined;
  if (id && typeof n.props.onClick === "function" && !out.has(id)) out.set(id, n);
  for (const c of n.children ?? []) if (typeof c === "object") pressables(c, out);
  return [...out.keys()];
};

for (const page of ["profile", "ai", "github"]) {
  for (const [who, space] of [["owner", northwind], ["member", harbor]] as const) {
    test(`${page} as ${who}: every control can be pressed`, async () => {
      const restore = installDom();
      try {
        const s = createSampleSettings(space);
        const { createRoot } = await import("test-renderer");
        const root = await mount(createRoot, <SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage={page as never} /></SettingsDataProvider>);
        const ids = pressables(root as N).filter((id) => !/^(row-|page-|hit-|saved-slot|undo|skin-thumb|settings-)/.test(id));
        assert.ok(ids.length > 0 || page === "signin", `${page} has controls`);
        const problems: string[] = [];
        for (const id of ids) { try { const n = find(root, id); if (n) await press(n); } catch (e) { problems.push(`${id}: ${(e as Error).message}`); } }
        assert.deepEqual(problems, []);
      } finally { restore(); }
    });
  }
}
