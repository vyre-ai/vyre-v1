// Test helper for the Console pages that have real controls: mounts a page over rows the live queries return and a `call` that records every capability the page asks for.
// Press a control by testID, then read `calls` for the capability and its input.
import { act } from "react";
import type { ReactElement } from "react";
import { find, flush, installDom, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { dataWith } from "./sheet-helper.tsx";

export interface Call { cap: string; input: Record<string, unknown> }
export interface Opened { page: string; args?: Record<string, unknown> | undefined }

export async function mountPage(el: ReactElement, rows: Record<string, unknown>, answer: (cap: string, input: Record<string, unknown>) => unknown = () => ({ ok: true }), extra: Partial<ConsoleData> = {}) {
  const restore = installDom();
  const calls: Call[] = [];
  const opened: Opened[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: (input ?? {}) as Record<string, unknown> });
    if (cap in rows) return rows[cap];
    return answer(cap, (input ?? {}) as Record<string, unknown>);
  };
  const base = dataWith(rows, { call: call as never, ...extra });
  const reads: Call[] = [];
  const inner = (base.screens as unknown as { capQuery(cap: string, input?: Record<string, unknown>): unknown }).capQuery;
  const screens = { ...base.screens, capQuery: (cap: string, input?: Record<string, unknown>) => { reads.push({ cap, input: input ?? {} }); return inner(cap, input); } } as never;
  const data: ConsoleData = { ...base, screens, nav: { ...base.nav, openPage: (page, args) => { opened.push({ page, args }); } } };
  const { createRoot } = await import("test-renderer");
  const renderer = createRoot();
  await act(async () => { renderer.render(<ConsoleDataProvider value={data}>{el}</ConsoleDataProvider>); });
  await flush();
  const root = renderer.container as unknown as Node;
  // unmounting first stops the page's timers and listeners, so the test process can end
  const close = (): void => { try { void act(() => { renderer.unmount(); }); } catch { /* already gone */ } restore(); };
  return {
    root, calls, reads, opened, restore: close,
    text: (): string => textOf(root),
    has: (id: string): boolean => find(root, id) !== null,
    find: (id: string): Node | null => find(root, id),
    press: (id: string): Promise<void> => press(find(root, id)),
    type: (id: string, value: string): Promise<void> => typeInto(find(root, id), value),
    called: (cap: string): Call[] => calls.filter((c) => c.cap === cap),
    read: (cap: string): Call[] => reads.filter((c) => c.cap === cap),
  };
}
