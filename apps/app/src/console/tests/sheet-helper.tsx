// Test helper: mount a Console page, press its "New ..." button and read what the create sheet drew.
// The test passes its renderer in (as ui/src/testing/dom.ts mount does), so this non-test file imports no dev dependency.
import type { ReactElement } from "react";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";

/** Whether any node in the tree carries this text as its tooltip (a title). */
export function hasTip(n: Node | string | null, text: string): boolean {
  if (n === null || typeof n === "string") return false;
  if (n.props?.title === text) return true;
  return (n.children ?? []).some((c) => hasTip(c, text));
}

export function dataWith(rows: Record<string, unknown>, extra: Partial<ConsoleData> = {}): ConsoleData {
  const sample = createSampleConsole().data;
  return { ...sample, ...extra, screens: { ...sample.screens, capQuery: (cap: string) => { const v = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => v }; } } as never };
}

/** Mounts the page, presses the button with this testID and returns the text of the page and a finder for nodes. */
export async function openSheet(createRoot: Parameters<typeof mount>[0], page: ReactElement, rows: Record<string, unknown>, openId: string, extra: Partial<ConsoleData> = {}) {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <ConsoleDataProvider value={dataWith(rows, extra)}>{page}</ConsoleDataProvider>);
    const before = textOf(root);
    await press(find(root, openId));
    return { before, text: textOf(root), root, find: (id: string) => find(root, id), press: (id: string) => press(find(root, id)) };
  } finally { restore(); }
}
