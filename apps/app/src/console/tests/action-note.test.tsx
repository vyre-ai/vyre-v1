// A failed action reads as one plain sentence. Its code and trace id are not in the text: a quiet Details shows both, with Copy.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { Button, Note, useAction } from "../pages/shared.tsx";
import { detailsOf, detailsText, errorSentence } from "../../errors/details.ts";
import { dataWith } from "./sheet-helper.tsx";

const FAIL = Object.assign(new Error("Deepgram did not accept that key. Check it and try again"), { code: "provider.auth_failed", traceId: "tr_3f9a01" });

test("errorSentence is the message with a full stop, and keeps the code and trace id aside", () => {
  const s = errorSentence(FAIL);
  assert.equal(s, "Deepgram did not accept that key. Check it and try again.");
  assert.ok(!/provider\.auth_failed|tr_3f9a01|Trace|\(/.test(s), "no code or trace in the sentence");
  assert.deepEqual(detailsOf(s), { code: "provider.auth_failed", traceId: "tr_3f9a01" });
  assert.equal(detailsText(detailsOf(s)!), "Code provider.auth_failed. Trace tr_3f9a01");
  assert.equal(errorSentence(new Error("Already a sentence.")), "Already a sentence.");
  assert.equal(detailsOf("Already a sentence."), null, "nothing kept when there was no code or trace");
  assert.equal(errorSentence({}, "Couldn't save this"), "Couldn't save this.");
});

function Probe(): ReturnType<typeof Note> {
  const action = useAction(() => undefined);
  return <><Button label="Run" testID="run" onPress={() => void action.run("voice.check", {})} />{action.note ? <Note>{action.note}</Note> : null}</>;
}

test("a failed action shows the sentence only; Details reveals the code and trace id and Copy copies them", async () => {
  const restore = installDom();
  const copied: string[] = [];
  const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (t: string) => { copied.push(t); } } } });
  try {
    const call = async (): Promise<unknown> => { throw FAIL; };
    const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({}, { call: call as never })}><Probe /></ConsoleDataProvider>);
    await press(find(root, "run"));
    const visible = textOf(root);
    assert.match(visible, /Deepgram did not accept that key\. Check it and try again\./);
    assert.ok(!/provider\.auth_failed|tr_3f9a01|Trace/.test(visible), "no code and no trace in the visible text");
    assert.match(visible, /Details/);
    assert.equal(find(root, "note-details-text"), null, "closed to begin with");
    await press(find(root, "note-details-toggle"));
    const open = textOf(root);
    assert.match(open, /Code provider\.auth_failed/); assert.match(open, /Trace tr_3f9a01/);
    await press(find(root, "note-details-copy"));
    assert.deepEqual(copied, ["Code provider.auth_failed. Trace tr_3f9a01"]);
    await press(find(root, "note-details-toggle"));
    assert.equal(find(root, "note-details-text"), null, "Hide details closes it");
  } finally { if (had) Object.defineProperty(globalThis, "navigator", had); else delete (globalThis as { navigator?: unknown }).navigator; restore(); }
});

test("a note with no code or trace has no Details", async () => {
  const restore = installDom();
  try {
    const call = async (): Promise<unknown> => { throw new Error("Nope"); };
    const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({}, { call: call as never })}><Probe /></ConsoleDataProvider>);
    await press(find(root, "run"));
    assert.match(textOf(root), /Nope\./); assert.equal(find(root, "note-details"), null);
  } finally { restore(); }
});
