// ui/FileDrop: what a drop or a paste carries, the zone's events (enter and leave counted so nothing flickers, the innermost zone takes the drop), the pane that hands its
// drops to the composer inside it, and the page guard that keeps a stray drop from opening the file in place of the app. Events are synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { DROP_LINE, DropRoute, DropZone, HeldFiles, carriesFiles, filesIn, guardFileDrops, pastedFiles, pastedName, useDropRoute } from "./index.tsx";
import type { DroppedFile, TransferLike } from "./index.tsx";

const file = (name: string, type = "image/png", size = 12): DroppedFile => ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(size) });
const shot = file("Screenshot 2026-11-03 at 10.14.02.png");
const drag = (files: DroppedFile[]): TransferLike => ({ types: ["Files"], files, items: files.map((f) => ({ kind: "file", type: f.type ?? "", getAsFile: () => f })), dropEffect: "none" });

interface Ev { dataTransfer?: TransferLike; clipboardData?: TransferLike; prevented: number; stopped: number; preventDefault(): void; stopPropagation(): void }
const ev = (o: { dataTransfer?: TransferLike; clipboardData?: TransferLike }): Ev => {
  const e: Ev = { ...o, prevented: 0, stopped: 0, preventDefault() { e.prevented++; }, stopPropagation() { e.stopped++; } };
  return e;
};
const fire = async (n: Node | null, name: string, e: Ev): Promise<Ev> => {
  if (!n) throw new Error("node not found");
  const fn = n.props[name] as ((x: Ev) => void) | undefined;
  assert.equal(typeof fn, "function", `the zone takes ${name}`);
  await act(async () => { fn!(e); });
  return e;
};

test("what is dragged is files when it says Files or holds a file item; text and in-app rows are not", () => {
  assert.equal(carriesFiles({ types: ["Files"] }), true, "dragover: the list is empty but the type says Files (a Finder file, a screenshot thumbnail)");
  assert.equal(carriesFiles({ types: [], items: [{ kind: "file" }] }), true);
  assert.equal(carriesFiles({ types: ["text/plain"] }), false, "a row dragged inside the app");
  assert.equal(carriesFiles({ types: ["text/uri-list", "text/plain"] }), false, "a link");
  assert.equal(carriesFiles(null), false);
});

test("the files of a drop come from files, else from the file items, never twice", () => {
  assert.deepEqual(filesIn(drag([shot])), [shot]);
  const a = file("a.pdf", "application/pdf");
  assert.deepEqual(filesIn({ types: ["Files"], files: [], items: [{ kind: "string", getAsFile: () => null }, { kind: "file", getAsFile: () => a }, { kind: "file", getAsFile: () => a }] }), [a], "an engine that fills only the items");
});

test("a paste carries a screenshot, an image from a browser or files from Finder; a copy from a document pastes its words", () => {
  const png = file("image.png");
  assert.deepEqual(pastedFiles({ types: ["Files"], files: [png] }), [png], "a screenshot copied to the clipboard");
  const finder = [file("Brief.pdf", "application/pdf"), file("Notes.txt", "text/plain")];
  assert.deepEqual(pastedFiles({ types: ["Files", "text/plain"], files: finder, getData: () => "Brief.pdf" }), finder, "files copied in Finder (the names come as plain text too)");
  const excel = { types: ["text/plain", "text/html", "Files"], files: [file("image.png")], getData: (t: string) => (t === "text/plain" ? "12\t14\n" : "<table>") };
  assert.deepEqual(pastedFiles(excel), [], "cells from a sheet: the picture of them is not what was meant");
  assert.deepEqual(pastedFiles({ types: ["text/plain"], files: [], getData: () => "hello" }), []);
  const browser = { types: ["text/html", "Files"], files: [png], getData: (t: string) => (t === "text/html" ? "<img src=x>" : "") };
  assert.deepEqual(pastedFiles(browser), [png], "Copy Image in a browser: html with no words, the image is the point");
});

test("a pasted screenshot without a real name gets one a person can read", () => {
  const at = new Date(2026, 10, 3, 9, 5, 7);
  assert.equal(pastedName(file("image.png"), at), "Pasted image 2026-11-03 at 09.05.07.png");
  assert.equal(pastedName(file("", "image/jpeg"), at), "Pasted image 2026-11-03 at 09.05.07.jpg");
  assert.equal(pastedName(file("Screenshot.png"), at), "Screenshot.png", "a named file keeps its name");
});

async function zone(el: ReactElement): Promise<Node> {
  return mount(createRoot, el);
}

test("a drop zone lights once while files are over it, however many children they cross, and takes the drop", async () => {
  const restore = installDom();
  try {
    const got: Array<{ names: string[]; how: string }> = [];
    const root = await zone(<DropZone testID="z" onFiles={(f, how) => got.push({ names: f.map((x) => x.name), how })}><DropZone testID="inner-none" onFiles={() => undefined} drop={false}><></></DropZone></DropZone>);
    const z = find(root, "z");
    assert.equal(find(root, "drop-overlay"), null, "nothing drawn before a drag");
    const enter = await fire(z, "onDragEnter", ev({ dataTransfer: drag([]) }));
    assert.equal(enter.prevented, 1);
    assert.match(textOf(find(root, "drop-overlay")), new RegExp(DROP_LINE));
    // the pointer moves onto a child: enter on the child comes before leave on the parent, so the count never touches zero
    await fire(z, "onDragEnter", ev({ dataTransfer: drag([]) }));
    await fire(z, "onDragLeave", ev({ dataTransfer: drag([]) }));
    assert.ok(find(root, "drop-overlay"), "still lit: no flicker crossing children");
    const over = ev({ dataTransfer: drag([]) });
    await fire(z, "onDragOver", over);
    assert.equal(over.prevented, 1, "dragover is taken, so the drop is allowed");
    assert.equal(over.dataTransfer?.dropEffect, "copy");
    const drop = await fire(z, "onDrop", ev({ dataTransfer: drag([shot]) }));
    assert.equal(drop.prevented, 1, "the page never opens the file");
    assert.equal(drop.stopped, 1, "an outer zone does not take it too");
    assert.deepEqual(got, [{ names: [shot.name], how: "drop" }]);
    assert.equal(find(root, "drop-overlay"), null, "the layer goes with the drop");
  } finally { restore(); }
});

test("leaving the zone clears the layer; a drag that is not files is left alone", async () => {
  const restore = installDom();
  try {
    let got = 0;
    const root = await zone(<DropZone testID="z" onFiles={() => { got++; }} />);
    const z = find(root, "z");
    await fire(z, "onDragEnter", ev({ dataTransfer: drag([]) }));
    await fire(z, "onDragLeave", ev({ dataTransfer: drag([]) }));
    assert.equal(find(root, "drop-overlay"), null);
    const text = { types: ["text/plain"], files: [], getData: () => "folder:fld_1" };
    const over = await fire(z, "onDragOver", ev({ dataTransfer: text }));
    assert.equal(over.prevented, 0, "an in-app row is not taken here");
    const drop = await fire(z, "onDrop", ev({ dataTransfer: text }));
    assert.equal(drop.prevented, 0);
    assert.equal(got, 0);
  } finally { restore(); }
});

test("a paste with files inside the zone takes them and stops the text paste; a paste of words passes", async () => {
  const restore = installDom();
  try {
    const got: Array<{ names: string[]; how: string }> = [];
    const root = await zone(<DropZone testID="z" onFiles={(f, how) => got.push({ names: f.map((x) => x.name), how })} />);
    const z = find(root, "z");
    const p = await fire(z, "onPaste", ev({ clipboardData: { types: ["Files"], files: [file("image.png")] } }));
    assert.equal(p.prevented, 1);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.how, "paste");
    assert.match(got[0]!.names[0]!, /^Pasted image \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/);
    const words = await fire(z, "onPaste", ev({ clipboardData: { types: ["text/plain"], files: [], getData: () => "hello" } }));
    assert.equal(words.prevented, 0, "the field pastes its words as usual");
    assert.equal(got.length, 1);
  } finally { restore(); }
});

test("a zone that is off takes nothing, but the drop still does not open the file in the window", async () => {
  const restore = installDom();
  try {
    let got = 0;
    const root = await zone(<DropZone testID="z" enabled={false} onFiles={() => { got++; }} />);
    const z = find(root, "z");
    await fire(z, "onDragEnter", ev({ dataTransfer: drag([]) }));
    assert.equal(find(root, "drop-overlay"), null, "no layer where nothing can be dropped");
    const over = await fire(z, "onDragOver", ev({ dataTransfer: drag([]) }));
    assert.equal(over.dataTransfer?.dropEffect, "none", "the pointer says no");
    const drop = await fire(z, "onDrop", ev({ dataTransfer: drag([shot]) }));
    assert.equal(drop.prevented, 1);
    await fire(z, "onPaste", ev({ clipboardData: { types: ["Files"], files: [shot] } }));
    assert.equal(got, 0);
  } finally { restore(); }
});

function Taker({ into }: { into: string[] }): ReactElement {
  useDropRoute((files) => { for (const f of files) into.push(f.name); });
  return <></>;
}

test("a pane hands a drop anywhere on it to the composer inside it; with no composer a drop does nothing", async () => {
  const restore = installDom();
  try {
    const into: string[] = [];
    const root = await zone(<DropRoute testID="pane"><Taker into={into} /></DropRoute>);
    const pane = find(root, "pane");
    await fire(pane, "onDragEnter", ev({ dataTransfer: drag([]) }));
    assert.ok(find(root, "drop-overlay"), "the whole pane lights");
    await fire(pane, "onDrop", ev({ dataTransfer: drag([shot]) }));
    assert.deepEqual(into, [shot.name]);

    const empty = await zone(<DropRoute testID="pane2" />);
    const pane2 = find(empty, "pane2");
    await fire(pane2, "onDragEnter", ev({ dataTransfer: drag([]) }));
    assert.equal(find(empty, "drop-overlay"), null, "a closed thread: nothing to drop into");
    const drop = await fire(pane2, "onDrop", ev({ dataTransfer: drag([shot]) }));
    assert.equal(drop.prevented, 1, "and the file still does not open in the window");
  } finally { restore(); }
});

test("a pane's other drags (a mounted folder from Files) go to its own handler", async () => {
  const restore = installDom();
  try {
    const seen: string[] = [];
    const root = await zone(<DropRoute testID="pane" onOther={(dt) => { seen.push(dt.getData?.("text/plain") ?? ""); return true; }} />);
    const pane = find(root, "pane");
    const dt = { types: ["text/plain"], files: [], getData: () => "mount:mnt_1" };
    const over = await fire(pane, "onDragOver", ev({ dataTransfer: dt }));
    assert.equal(over.prevented, 1, "a text drag may drop on the pane");
    const drop = await fire(pane, "onDrop", ev({ dataTransfer: dt }));
    assert.equal(drop.prevented, 1);
    assert.deepEqual(seen, ["mount:mnt_1"]);
  } finally { restore(); }
});

test("the page guard stops a stray file drop from opening the file, and leaves text drags and zones alone", () => {
  const on: Record<string, (e: Ev & { defaultPrevented?: boolean }) => void> = {};
  const win = { addEventListener: (t: string, fn: (e: Ev) => void) => { on[t] = fn; }, removeEventListener: (t: string) => { delete on[t]; } };
  const off = guardFileDrops(win);
  const over = ev({ dataTransfer: drag([]) });
  on["dragover"]!(over);
  assert.equal(over.prevented, 1);
  assert.equal(over.dataTransfer?.dropEffect, "none", "the pointer says nothing can be dropped there");
  const drop = ev({ dataTransfer: drag([shot]) });
  on["drop"]!(drop);
  assert.equal(drop.prevented, 1, "the window does not navigate to the file");
  const text = ev({ dataTransfer: { types: ["text/plain"] } });
  on["dragover"]!(text);
  on["drop"]!(text);
  assert.equal(text.prevented, 0, "text and in-app drags keep their own behaviour");
  const taken = Object.assign(ev({ dataTransfer: drag([]) }), { defaultPrevented: true });
  taken.dataTransfer!.dropEffect = "copy";
  on["dragover"]!(taken);
  assert.equal(taken.dataTransfer?.dropEffect, "copy", "a zone that took the drag keeps its answer");
  off();
  assert.deepEqual(Object.keys(on), []);
  assert.doesNotThrow(() => guardFileDrops(undefined)());
});

test("held files list their names and each can be taken off", async () => {
  const restore = installDom();
  try {
    const removed: number[] = [];
    const root = await mount(createRoot, <HeldFiles testID="held" files={[{ name: "Brief.pdf" }, { name: "Shot.png" }]} onRemove={(i) => removed.push(i)} />);
    assert.match(textOf(find(root, "held")), /Brief\.pdf[\s\S]*Shot\.png/);
    await press(find(root, "held-remove-1"));
    await flush();
    assert.deepEqual(removed, [1]);
  } finally { restore(); }
});
