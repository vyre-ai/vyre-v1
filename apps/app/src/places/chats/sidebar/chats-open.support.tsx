// Shared by the sidebar selection and imported-menu tests (split so each file stays well inside the fast shard's 30 s).
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { installDom, find, flush } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "./sample.ts";
import type { SampleImported } from "./sample.ts";

export const D = (m: number, d: number, h = 9): number => Date.UTC(2025, m - 1, d, h, 0, 0);
export const IMPORTED: SampleImported[] = [
  { conversationId: "isc_a", provider: "claude_code", title: "Fix the login", startedAt: D(10, 20), importedAt: D(10, 21) },
  // continued in the chat "October invoices" (c3), last active 24 Oct
  { conversationId: "isc_b", provider: "codex", title: "Release work", startedAt: D(9, 1), importedAt: D(9, 2), continuedThreadId: "c3" },
];

/** Row ids only, not the slots inside a row. */
export const rowIds = (root: Node, prefix: string): string[] => ids(root).filter((i) => i.startsWith(prefix) && !i.endsWith("-leading") && !i.endsWith("-trailing"));
export const ids = (n: Node | string, out: string[] = []): string[] => { if (typeof n === "string") return out; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach((c) => ids(c, out)); return out; };
/** The rows drawn selected, by their entry key. */
export const selectedRows = (root: Node): string[] => {
  const out: string[] = [];
  const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"]; if (typeof t === "string" && t.startsWith("row-") && n.props["aria-selected"] === true) out.push(t.slice(4)); (n.children ?? []).forEach(walk); };
  walk(root);
  return out;
};
export const chainTo = (n: Node, id: string, up: Node[] = []): Node[] | null => { if (n.props["data-testid"] === id) return up; for (const c of n.children ?? []) if (typeof c !== "string") { const f = chainTo(c, id, [...up, n]); if (f) return f; } return null; };
/** Right-click on a row: the nearest ancestor that opens its menu. */

/** The sidebar drawn with what the middle shows; `show` changes that the way a tab, a link or Cmd-K does (the place re-renders it with the new open key). */
/** `make` is test-renderer's createRoot, handed in by the test file (only test files may import that dev dependency). */
export async function drawn(make: () => { render(el: ReactElement): void; container: unknown }, o: { imported?: SampleImported[]; open?: string | null; artifacts?: boolean } = {}) {
  installDom();
  const s = createSampleSidebar(northwind, o.imported ? { imported: o.imported } : {});
  const news: string[] = [];
  const data = { ...s.data, nav: { ...s.data.nav, openImported: (id: string) => void s.opened.push(`imported:${id}`), openNew: () => void news.push("new"), ...(o.artifacts ? { openArtifacts: () => void s.opened.push("artifacts") } : {}) } };
  const r = make();
  const el = (open: string | null): ReactElement => <ChatsSidebar data={data} window={{ start: 0, end: 500 }} open={open} />;
  await act(async () => { r.render(el(o.open ?? null)); });
  await flush();
  const root = r.container as unknown as Node;
  const show = async (open: string | null): Promise<void> => { await act(async () => { r.render(el(open)); }); await flush(); };
  return { s, root, show, news };
}

/* ---------- what is open, as a key ---------- */

/** A right-click on a row's own handler, as the browser sends it: the row's menu opens. */
export const rightClick = async (root: Node, rowId: string): Promise<void> => {
  const w = [...(chainTo(root, rowId) ?? [])].reverse().find((n) => typeof n.props.onContextMenu === "function");
  assert.ok(w, `${rowId} opens a menu on right-click`);
  await act(async () => { (w.props.onContextMenu as (e: unknown) => void)({ preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} }); });
  await flush();
};
