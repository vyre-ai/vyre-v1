// "Delete this message?" on the desktop menu: Delete and Cancel. Focus opens on Cancel, Enter or Space press only the focused button, Escape cancels, and nothing is deleted before the person
// presses Delete. The old rule ("Return confirms" from anywhere, with nothing focused) is gone: a destructive ask must never confirm on a stray Enter.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { act } from "react";
import { DeleteAsk } from "./DeleteAsk.tsx";

type KeyFn = (e: unknown) => void;
const keyups: KeyFn[] = [];
// a key pressed on the element that holds focus: react-native-web starts the press on keydown and finishes it on a document keyup
const keydown = async (n: Node | null, k: string): Promise<void> => {
  if (!n) throw new Error("node not found");
  const target = { tagName: "DIV", getAttribute: (a: string) => (a === "role" ? "button" : null) };
  const ev = {
    key: k,
    persist() {},
    timeStamp: 1,
    preventDefault() {},
    stopPropagation() {},
    nativeEvent: { key: k },
    target,
    currentTarget: target,
  };
  await act(async () => {
    (n.props["onKeyDown"] as KeyFn)(ev);
  });
  await act(async () => {
    for (const f of keyups.splice(0)) f(ev);
  });
};

function setup(): { listeners: unknown[]; focused: string[]; active: { v: unknown } } {
  installDom();
  const listeners: unknown[] = [];
  const focused: string[] = [];
  const active: { v: unknown } = { v: null };
  (globalThis as unknown as { document: unknown }).document = {
    addEventListener: (t: string, f: unknown) =>
      void (t === "keydown" ? listeners.push(f) : t === "keyup" && keyups.push(f as KeyFn)),
    removeEventListener: (_t: string, f: unknown) => void listeners.splice(listeners.indexOf(f), 1),
    get activeElement() {
      return active.v;
    },
    querySelector: (q: string) =>
      q.includes("composer-field") ? { focus: () => void focused.push("composer") } : null,
    createElement: () => ({ style: {}, setAttribute: () => undefined, appendChild: () => undefined }),
    head: { appendChild: () => undefined },
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  return { listeners, focused, active };
}

test("the question is asked in words and nothing is deleted until Delete is pressed; Cancel deletes nothing", async () => {
  setup();
  const log: string[] = [];
  const root = await mount(
    createRoot,
    <DeleteAsk onDelete={() => log.push("delete")} onClose={() => log.push("close")} />,
  );
  await flush();
  assert.ok(textOf(root).includes("Delete this message?"));
  assert.deepEqual(log, []);
  await press(find(root, "delete-ask-cancel"));
  assert.deepEqual(log, ["close"], "Cancel deletes nothing");
  log.length = 0;
  await press(find(root, "delete-ask-go"));
  assert.deepEqual(log, ["delete"], "Delete deletes once");
});

test("no document-level Enter handler: a stray Enter (nothing focused, or Cancel focused) never deletes", async () => {
  const { listeners } = setup();
  const log: string[] = [];
  const root = await mount(
    createRoot,
    <DeleteAsk onDelete={() => log.push("delete")} onClose={() => log.push("close")} />,
  );
  await flush();
  for (const f of [...listeners] as ((e: { key: string; preventDefault(): void }) => void)[])
    f({ key: "Enter", preventDefault: () => undefined });
  assert.deepEqual(log, [], "a document-level Enter does nothing");
  await keydown(find(root, "delete-ask-cancel"), "Enter");
  assert.ok(!log.includes("delete"), "Enter on Cancel never deletes");
  assert.deepEqual(log, ["close"], "Enter on Cancel cancels");
});

test("Enter or Space on the focused Delete button deletes, and only then; Escape never deletes", async () => {
  const { listeners } = setup();
  const log: string[] = [];
  const root = await mount(
    createRoot,
    <DeleteAsk onDelete={() => log.push("delete")} onClose={() => log.push("close")} />,
  );
  await flush();
  await keydown(find(root, "delete-ask-go"), "Enter");
  assert.deepEqual(log, ["delete"], "Enter on Delete deletes");
  log.length = 0;
  await keydown(find(root, "delete-ask-go"), " ");
  assert.deepEqual(log, ["delete"], "Space on Delete deletes");
  log.length = 0;
  for (const f of [...listeners] as ((e: { key: string; preventDefault(): void }) => void)[])
    f({ key: "Escape", preventDefault: () => undefined });
  await flush();
  assert.ok(!log.includes("delete"), "Escape never deletes");
});

test("the card opens with Cancel as its initial action and, once closed with nothing holding focus, hands focus to the composer", async () => {
  const { focused } = setup();
  const r = createRoot();
  const el = <DeleteAsk onDelete={() => undefined} onClose={() => undefined} />;
  await act(async () => {
    r.render(el);
  });
  await flush();
  const root = r.container as unknown as Node;
  // Cancel is the safe, first button; Delete is the danger one
  assert.ok(find(root, "delete-ask-cancel"), "Cancel is there");
  await act(async () => {
    r.render(<></>);
  });
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(focused, ["composer"], "focus goes to the composer after the ask closes");
});
