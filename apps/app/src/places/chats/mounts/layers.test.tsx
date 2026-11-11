// The popover (All agents, the terminal list) and the sheet (Connect an outside agent, the terminal rules) close three ways: Escape, a press on their veil, and the control inside them that
// chooses. One Escape closes one layer: a menu opened from the popover closes first, the popover on the next Escape (the Personal first-hour walk presses Escape twice for exactly this).
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, find, flush, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { escapeLayers } from "../../../../../../ui/src/Overlay/escape.ts";
import { LayerHead, Popover, Sheet } from "./Layers.tsx";

type Ev = { key: string; defaultPrevented?: boolean; preventDefault(): void; stopPropagation(): void };
type Fn = (e: Ev) => void;
/** A document that runs capture listeners, then bubble ones, and stops when a listener stops the event: the order a browser uses. */
function browserDocument(): { press(key: string): void; restore(): void } {
  const doc = (globalThis as { document: Record<string, unknown> }).document;
  const had = { add: Object.getOwnPropertyDescriptor(doc, "addEventListener"), remove: Object.getOwnPropertyDescriptor(doc, "removeEventListener") };
  const capture: Fn[] = []; const bubble: Fn[] = [];
  const list = (c?: boolean): Fn[] => (c ? capture : bubble);
  doc["addEventListener"] = (_t: string, f: Fn, c?: boolean) => { list(c).push(f); };
  doc["removeEventListener"] = (_t: string, f: Fn, c?: boolean) => { const l = list(c); const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  return {
    press(key) {
      let stopped = false;
      const e: Ev = { key, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
      for (const f of [...capture, ...bubble]) { if (stopped) break; f(e); }
    },
    restore() {
      if (had.add) Object.defineProperty(doc, "addEventListener", had.add); else delete doc["addEventListener"];
      if (had.remove) Object.defineProperty(doc, "removeEventListener", had.remove); else delete doc["removeEventListener"];
    },
  };
}

async function withKeys(run: (keys: ReturnType<typeof browserDocument>) => Promise<void>): Promise<void> {
  const restoreDom = installDom();
  const keys = browserDocument();
  try { await run(keys); } finally { keys.restore(); restoreDom(); }
}

type Api = ReturnType<typeof useMenu>;
let api: Api | null = null;
function PopoverWithMenu({ log }: { log: string[] }): ReactElement {
  const m = useMenu();
  api = m;
  return (
    <>
      <Popover x={10} y={10} label="Terminals" testID="pop" onClose={() => log.push("popover")}>
        <LayerHead title="Terminals" onClose={() => log.push("head")} />
        <Text>row</Text>
      </Popover>
      {m.element}
    </>
  );
}

test("a popover closes on its veil, on Escape, and from the close control in its head", async () => {
  await withKeys(async (keys) => {
    const log: string[] = [];
    const root = await mount(createRoot, <Popover x={10} y={10} label="Terminals" testID="pop" onClose={() => log.push("closed")}><LayerHead title="Terminals" onClose={() => log.push("head")} /></Popover>);
    assert.ok(find(root, "pop") && find(root, "pop-veil"), "the popover and its veil");
    await press(find(root, "pop-veil"));
    assert.deepEqual(log, ["closed"], "a press on the veil");
    await press(find(root, "layer-close"));
    assert.deepEqual(log, ["closed", "head"], "the close control");
    await act(async () => { keys.press("Escape"); });
    assert.deepEqual(log, ["closed", "head", "closed"], "Escape");
  });
});

test("a sheet closes on its veil, on Escape, and from the close control in its head", async () => {
  await withKeys(async (keys) => {
    const log: string[] = [];
    const root = await mount(createRoot, <Sheet label="Rules" testID="sheet" onClose={() => log.push("closed")}><LayerHead title="Rules" onClose={() => log.push("head")} /></Sheet>);
    assert.ok(find(root, "sheet") && find(root, "sheet-veil"));
    await act(async () => { keys.press("Escape"); });
    assert.deepEqual(log, ["closed"], "Escape");
    await press(find(root, "layer-close"));
    assert.deepEqual(log, ["closed", "head"], "the close control");
  });
});

test("a menu over a popover: the first Escape closes the menu and leaves the popover and its veil up; the second closes the popover", async () => {
  await withKeys(async (keys) => {
    const log: string[] = [];
    const root = await mount(createRoot, <PopoverWithMenu log={log} />);
    await act(async () => { api!.show([{ label: "This computer", onSelect: () => undefined }], 20, 20, "other"); });
    await flush();
    assert.ok(find(root, "menu"), "the menu is open over the popover");
    await act(async () => { keys.press("Escape"); });
    await flush();
    assert.equal(find(root, "menu"), null, "the menu closed");
    assert.deepEqual(log, [], "the popover did not close with it");
    assert.ok(find(root, "pop") && find(root, "pop-veil"), "the popover and its veil are still up");
    await act(async () => { keys.press("Escape"); });
    assert.deepEqual(log, ["popover"], "the next Escape closes the popover");
  });
});

test("a popover and a sheet leave no Escape layer behind when they close", async () => {
  await withKeys(async () => {
    const before = escapeLayers();
    const r = createRoot();
    await act(async () => { r.render(<Popover x={1} y={1} label="A" testID="p" onClose={() => undefined}><Text>a</Text></Popover>); });
    assert.equal(escapeLayers(), before + 1);
    await act(async () => { r.render(<Text>gone</Text>); });
    assert.equal(escapeLayers(), before, "the layer left with the popover");
    await act(async () => { r.render(<Sheet label="B" testID="s" onClose={() => undefined}><Text>b</Text></Sheet>); });
    assert.equal(escapeLayers(), before + 1);
    await act(async () => { r.render(<Text>gone</Text>); });
    assert.equal(escapeLayers(), before);
  });
});
