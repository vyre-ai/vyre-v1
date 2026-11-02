// ui/Composer takes dropped and pasted files, full and compact: a drop or a Cmd-V of a screenshot lands in the tray and goes out with the send. Inside a pane that takes
// drops for it (a chat), the pane is the zone. A composer whose send cannot carry files takes none. Events are synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { View } from "react-native";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { DropRoute } from "../FileDrop/index.tsx";
import type { DroppedFile, TransferLike } from "../FileDrop/index.tsx";
import { Composer } from "./index.tsx";
import type { ComposerSend } from "./index.tsx";

const file = (name: string, type = "image/png", size = 2048): DroppedFile => ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(size) });
const shot = file("Screenshot 2026-11-03 at 10.14.02.png");
const drag = (files: DroppedFile[]): TransferLike => ({ types: ["Files"], files, dropEffect: "none" });
const ev = (o: { dataTransfer?: TransferLike; clipboardData?: TransferLike }) => {
  const e = { ...o, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* the innermost zone keeps it */ } };
  return e;
};
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  const fn = n.props[name] as ((x: object) => void) | undefined;
  assert.equal(typeof fn, "function", `takes ${name}`);
  await act(async () => { fn!(e); });
  await flush();
}

test("why the zone is its own element: react-native-web keeps drag and paste props off a View, so a handler given to one never reaches the page", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <View testID="plain" {...({ onDrop: () => undefined, onDragOver: () => undefined, onPaste: () => undefined } as object)} />);
    const n = find(root, "plain")!;
    assert.equal(n.props["onDrop"], undefined);
    assert.equal(n.props["onDragOver"], undefined);
    assert.equal(n.props["onPaste"], undefined);
  } finally { restore(); }
});

for (const density of ["regular", "compact"] as const) {
  test(`${density}: a file dropped on the composer lands in the tray and goes out with the send`, async () => {
    const restore = installDom();
    try {
      const sent: ComposerSend[] = [];
      const seen: string[] = [];
      const root = await mount(createRoot, <Composer whoWillAnswer="Intake will reply" density={density} onSubmit={(p) => sent.push(p)} onFiles={(f) => seen.push(...f.map((x) => x.name))} />);
      const host = find(root, "composer-drop");
      await fire(host, "onDragEnter", ev({ dataTransfer: drag([]) }));
      assert.match(textOf(find(root, "composer-drop-overlay")), /Drop to attach/);
      const d = ev({ dataTransfer: drag([shot]) });
      await fire(host, "onDrop", d);
      assert.equal(d.prevented, 1, "the window never opens the file");
      assert.equal(find(root, "composer-drop-overlay"), null);
      assert.match(textOf(find(root, "composer-file-0")), /Screenshot 2026-11-03 at 10\.14\.02\.png/);
      assert.deepEqual(seen, [shot.name]);
      await press(find(root, "composer-send"));
      await flush();
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0]!.files.map((f) => [f.name, f.mime, f.size, f.file === shot]), [[shot.name, "image/png", 2048, true]], "the File itself goes, so the sender reads its bytes");
    } finally { restore(); }
  });

  test(`${density}: Cmd-V of a screenshot attaches it with a readable name; Cmd-V of words types them`, async () => {
    const restore = installDom();
    try {
      const root = await mount(createRoot, <Composer whoWillAnswer="Intake will reply" density={density} />);
      const host = find(root, "composer-drop");
      const p = ev({ clipboardData: { types: ["Files"], files: [file("image.png")] } });
      await fire(host, "onPaste", p);
      assert.equal(p.prevented, 1);
      assert.match(textOf(find(root, "composer-file-0")), /Pasted image \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png/);
      const finder = ev({ clipboardData: { types: ["Files", "text/plain"], files: [file("Brief.pdf", "application/pdf")], getData: () => "Brief.pdf" } });
      await fire(host, "onPaste", finder);
      assert.match(textOf(find(root, "composer-file-1")), /Brief\.pdf/, "files copied in Finder");
      const words = ev({ clipboardData: { types: ["text/plain"], files: [], getData: () => "hello" } });
      await fire(host, "onPaste", words);
      assert.equal(words.prevented, 0, "the field pastes its words itself");
      assert.equal(find(root, "composer-file-2"), null);
    } finally { restore(); }
  });
}

test("inside a chat pane, a drop anywhere on the pane goes to the composer's tray, and the composer itself paints no second layer", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <DropRoute testID="pane"><View testID="messages" /><Composer whoWillAnswer="Intake will reply" /></DropRoute>);
    const pane = find(root, "pane");
    assert.equal(find(root, "composer-drop")?.props["onDrop"], undefined, "the pane is the zone");
    assert.equal(typeof find(root, "composer-drop")?.props["onPaste"], "function", "paste stays the field's own");
    await fire(pane, "onDragEnter", ev({ dataTransfer: drag([]) }));
    assert.ok(find(root, "drop-overlay"), "the pane lights");
    assert.equal(find(root, "composer-drop-overlay"), null);
    await fire(pane, "onDrop", ev({ dataTransfer: drag([shot, file("Brief.pdf", "application/pdf")]) }));
    assert.match(textOf(find(root, "composer-file-0")), /Screenshot/);
    assert.match(textOf(find(root, "composer-file-1")), /Brief\.pdf/);
  } finally { restore(); }
});

test("a composer whose send cannot carry files takes none: no Upload, and a drop or paste is refused without opening the file", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Composer whoWillAnswer="Assistant" takesFiles={false} />);
    const host = find(root, "composer-drop");
    const d = ev({ dataTransfer: drag([shot]) });
    await fire(host, "onDrop", d);
    assert.equal(d.prevented, 1);
    await fire(host, "onPaste", ev({ clipboardData: { types: ["Files"], files: [shot] } }));
    assert.equal(find(root, "composer-file-0"), null);
    await press(find(root, "composer-attach"));
    await flush();
    assert.equal(find(root, "plus-upload"), null, "no Upload row");
  } finally { restore(); }
});
