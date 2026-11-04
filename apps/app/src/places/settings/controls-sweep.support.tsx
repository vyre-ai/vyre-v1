// Shared by the controls-sweep tests: mounts one Settings page for an Owner or a Member and presses every control that has a test id once; none may throw. No test imports here.
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { createSampleSettings, harbor, northwind } from "./sample.ts";

// The saved line (SAVED_MS) and the pages' polls hold a timer for seconds; a timer must not keep the test process alive after the last test, which is what made each file take 9 s for 1.3 s of tests
for (const k of ["setInterval", "setTimeout"] as const) { const orig = globalThis[k] as (...a: unknown[]) => { unref?: () => void }; (globalThis as Record<string, unknown>)[k] = (...a: unknown[]) => { const h = orig(...a); h?.unref?.(); return h; }; }

interface N { props: Record<string, unknown>; children?: (N | string)[] }
const pressables = (n: N, out: Map<string, N> = new Map()): string[] => {
  const id = (n.props?.["data-testid"] ?? n.props?.testID) as string | undefined;
  if (id && typeof n.props.onClick === "function" && !out.has(id)) out.set(id, n);
  for (const c of n.children ?? []) if (typeof c === "object") pressables(c, out);
  return [...out.keys()];
};

/** `createRoot` comes from the test file: only tests import test-renderer (boundaries B6). */
export async function sweep(createRoot: Parameters<typeof mount>[0], page: string, who: "owner" | "member"): Promise<void> {
  const restore = installDom();
  try {
    const s = createSampleSettings(who === "owner" ? northwind : harbor);
    const root = await mount(createRoot, <SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage={page as never} /></SettingsDataProvider>);
    const ids = pressables(root as N).filter((id) => !/^(row-|page-|hit-|saved-slot|undo|skin-thumb|settings-)/.test(id));
    assert.ok(ids.length > 0 || page === "signin", `${page} has controls: ${textOf(root as never).slice(0, 200)}`);
    const problems: string[] = [];
    for (const id of ids) { try { const n = find(root, id); if (n) await press(n); } catch (e) { problems.push(`${id}: ${(e as Error).message}`); } }
    assert.deepEqual(problems, []);
  } finally { restore(); }
}
