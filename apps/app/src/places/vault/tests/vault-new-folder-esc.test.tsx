// Vault > the + beside Shared opens a Folder name box; Esc puts it away without making the folder (owner, 13 Nov 2026: "needs a click elsewhere").
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Counts } from "../layout/model.ts";
import { Sidebar } from "../layout/Sidebar.tsx";

const counts = { all: 0, mine: 0, requested: 0, folders: new Map<string, number>(), keys: 0, logins: 0, cards: 0, health: 0 } as unknown as Counts;

type Fn = (e: { key?: string; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void }) => void;
/** A document whose Escape reaches the layers the way a browser's capture phase does. */
function fakeDocument(): { esc(): void; restore(): void } {
  const g = globalThis as { document?: Record<string, unknown> };
  const had = g.document;
  const cap = new Set<Fn>(), bub = new Set<Fn>();
  const doc = { ...(had ?? {}), addEventListener: (_t: string, f: Fn, c?: boolean) => { (c ? cap : bub).add(f); }, removeEventListener: (_t: string, f: Fn, c?: boolean) => { (c ? cap : bub).delete(f); } };
  g.document = doc;
  return { esc: () => { const e = { key: "Escape", preventDefault() { /* nothing */ }, stopPropagation() { /* nothing */ } }; for (const f of [...cap, ...bub]) f(e); }, restore: () => { if (had === undefined) delete g.document; else g.document = had; } };
}

test("Esc puts the new-folder name box away, and the blur that follows does not make the folder", async () => {
  const restore = installDom();
  const doc = fakeDocument();
  const made: string[] = [];
  let down: (() => Promise<void>) | null = null;
  try {
    const r = createRoot() as unknown as { render(e: unknown): void; unmount(): void; container: unknown };
    down = async () => { await act(async () => { r.unmount(); }); };
    const root = await mount(() => r as never, <Sidebar counts={counts} folders={[]} selection={{ kind: "all" }} onSelect={() => undefined} onAdvanced={() => undefined} onNewFolder={async (n) => { made.push(n); }} onFolderMenu={() => undefined} canCreateShared />);
    await press(find(root, "new-folder"));
    assert.ok(find(root, "new-folder-name") !== null, "the name box opens");
    await typeInto(find(root, "new-folder-name"), "Clients");
    await act(async () => { doc.esc(); });
    await flush();
    assert.ok(find(root, "new-folder-name") === null, "Esc puts the box away");
    assert.deepEqual(made, [], "nothing was made");
  } finally { await down?.(); doc.restore(); restore(); }
});
