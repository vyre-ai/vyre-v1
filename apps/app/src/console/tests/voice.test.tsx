// Console > AI > Voice. UI only: voice.status, voice.set, voice.check and voice.remove have no backend yet, so the server here is a scripted call. Each control is pressed by its id and
// the capability it calls is asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { VoicePage, agoWords, voiceLine } from "../pages/Voice.tsx";
import { dataWith } from "./sheet-helper.tsx";

const NOW = Date.now();
async function page(status: Record<string, unknown>) {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "voice.status") return status;
    if (cap.startsWith("voice.")) return { ok: true };
    throw new Error(`unscripted ${cap}`);
  };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({}, { call: call as never })}><VoicePage /></ConsoleDataProvider>);
  return { root, calls, restore };
}
const writes = (calls: Array<{ cap: string; input: Record<string, unknown> }>) => calls.filter((c) => c.cap !== "voice.status");
const ON = { set: true, on: true, own: 2, who: "Irfad Imtiaz", checkedAt: NOW - 4 * 60_000 };

test("the words", () => {
  assert.equal(voiceLine({ set: false, on: false, own: 0 }), "Not set up");
  assert.equal(voiceLine({ set: true, on: true, own: 0 }), "On for everyone");
  assert.equal(voiceLine({ set: true, on: false, own: 0 }), "Off for everyone");
  assert.equal(agoWords(NOW - 4 * 60_000, NOW), "4 minutes ago");
  assert.equal(agoWords(undefined, NOW), "not yet");
});

test("a set key shows the status line, who added it, when it was checked and who has their own key", async () => {
  const { root, restore } = await page(ON);
  try {
    const text = textOf(root);
    assert.match(text, /On for everyone/);
    assert.match(text, /Deepgram · Irfad Imtiaz added it · checked 4 minutes ago/);
    assert.match(text, /People with their own key/);
    assert.match(text, /2\. Their own key wins for them/);
    assert.equal(find(root, "voice-key"), null, "no key field while a key is set");
  } finally { restore(); }
});

test("with no key the field shows, and Turn on for everyone sends the key with on true (disabled until a key is pasted)", async () => {
  const { root, calls, restore } = await page({ set: false, on: false, own: 0 });
  try {
    assert.match(textOf(root), /Not set up/);
    await press(find(root, "voice-save"));
    assert.equal(writes(calls).length, 0, "nothing to send yet");
    await typeInto(find(root, "voice-key"), "dg-test-key");
    await press(find(root, "voice-save"));
    assert.deepEqual(writes(calls), [{ cap: "voice.set", input: { key: "dg-test-key", on: true } }]);
  } finally { restore(); }
});

test("Replace key opens the field, Cancel closes it, and saving sends only the new key", async () => {
  const { root, calls, restore } = await page(ON);
  try {
    await press(find(root, "voice-replace"));
    assert.ok(find(root, "voice-key"));
    await press(find(root, "voice-cancel"));
    assert.equal(find(root, "voice-key"), null);
    await press(find(root, "voice-replace"));
    await typeInto(find(root, "voice-key"), "dg-new");
    await press(find(root, "voice-save"));
    assert.deepEqual(writes(calls), [{ cap: "voice.set", input: { key: "dg-new" } }]);
  } finally { restore(); }
});

test("Turn off sends on false; Turn on sends on true", async () => {
  const on = await page(ON);
  try { await press(find(on.root, "voice-toggle")); assert.deepEqual(writes(on.calls), [{ cap: "voice.set", input: { on: false } }]); } finally { on.restore(); }
  const off = await page({ ...ON, on: false });
  try {
    assert.match(textOf(off.root), /Off for everyone/);
    await press(find(off.root, "voice-toggle"));
    assert.deepEqual(writes(off.calls), [{ cap: "voice.set", input: { on: true } }]);
  } finally { off.restore(); }
});

test("Check now calls voice.check and Remove key calls voice.remove", async () => {
  const a = await page(ON);
  try { await press(find(a.root, "voice-check")); assert.deepEqual(writes(a.calls), [{ cap: "voice.check", input: {} }]); } finally { a.restore(); }
  const b = await page(ON);
  try { await press(find(b.root, "voice-remove")); assert.deepEqual(writes(b.calls), [{ cap: "voice.remove", input: {} }]); } finally { b.restore(); }
});
