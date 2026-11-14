// "Delete this message?" on the desktop menu: Delete and Cancel, Return confirms, Escape cancels, and nothing is deleted before one of them.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { DeleteAsk } from "./DeleteAsk.tsx";

const listeners: ((e: { key: string; preventDefault(): void }) => void)[] = [];
const key = (k: string): void => {
  for (const f of [...listeners]) f({ key: k, preventDefault: () => undefined });
};

test("the question is asked in words and nothing is deleted until Delete or Return; Cancel and Escape delete nothing", async () => {
  installDom();
  // the stand-in document hears nothing: a small one that keeps the key listeners the card adds
  (globalThis as unknown as { document: unknown }).document = {
    addEventListener: (t: string, f: (typeof listeners)[number]) => void (t === "keydown" && listeners.push(f)),
    removeEventListener: (_t: string, f: (typeof listeners)[number]) => void listeners.splice(listeners.indexOf(f), 1),
  };
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
  log.length = 0;
  key("Enter");
  assert.deepEqual(log, ["delete"], "Return confirms");
  log.length = 0;
  key("Escape");
  await flush();
  assert.ok(!log.includes("delete"), "Escape never deletes");
});
