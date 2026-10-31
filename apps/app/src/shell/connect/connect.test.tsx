// Connect in place: the footer every account picker ends with, the host that opens the real flow over the page, and what a finished flow hands back.
import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { Pressable, Text } from "react-native";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { ConnectInlineHost } from "./ConnectInline.tsx";
import { useConnectInline } from "./context.ts";
import { connectEntries, connectLabel, connectThen, stepNeed } from "./model.ts";
import type { Connected, ConnectNeed } from "./model.ts";

const labels = (entries: readonly MenuEntry[]): string[] => entries.map((e) => ("label" in e ? e.label : "separator" in e ? "---" : "head" in e ? e.head : ""));
const selectLast = (entries: readonly MenuEntry[]): void => { const last = entries[entries.length - 1]; if (last && "onSelect" in last) last.onSelect?.(); };
const made: Connected = { id: "mbx_new", title: "firm@example.com", app: "mail" };

test("an empty picker ends in Connect with the thing's own words", () => {
  const need = (kind: ConnectNeed): string => connectLabel(kind, true);
  assert.equal(need({ kind: "mailbox" }), "Connect a mailbox");
  assert.equal(need({ kind: "ai" }), "Add an AI account");
  assert.equal(need({ kind: "key" }), "Add a key");
  assert.equal(need({ kind: "number" }), "Connect Twilio");
  assert.equal(need({ kind: "connector", service: "dropbox" }), "Connect Dropbox");
  assert.equal(need({ kind: "connector", service: "google" }), "Connect Google");
  const entries = connectEntries([], { kind: "mailbox" }, async () => made, () => undefined, true);
  assert.deepEqual(labels(entries), ["Connect a mailbox"]);
});

test("a picker with accounts still ends in + Connect another, after a separator", () => {
  const rows: MenuEntry[] = [{ label: "ana@example.com", checked: true }];
  const entries = connectEntries(rows, { kind: "mailbox" }, async () => made, () => undefined);
  assert.deepEqual(labels(entries), ["ana@example.com", "---", "+ Connect another"]);
});

test("with no way to open a flow the picker is left as it was: no button that does nothing", () => {
  const rows: MenuEntry[] = [{ label: "ana@example.com" }];
  assert.deepEqual(labels(connectEntries(rows, { kind: "mailbox" }, null, () => undefined)), ["ana@example.com"]);
});

test("choosing Connect opens the flow, and finishing hands the new account to the picker", async () => {
  const opened: ConnectNeed[] = [];
  const got: Connected[] = [];
  const entries = connectEntries([], { kind: "mailbox" }, async (need) => { opened.push(need); return made; }, (a) => got.push(a), true);
  selectLast(entries);
  await flush();
  assert.deepEqual(opened, [{ kind: "mailbox" }]);
  assert.deepEqual(got, [made]);
});

test("leaving the flow, or a flow that fails, selects nothing", async () => {
  const got: Connected[] = [];
  assert.equal(await connectThen(async () => null, { kind: "ai" }, (a) => got.push(a)), false);
  assert.equal(await connectThen(async () => { throw new Error("no"); }, { kind: "ai" }, (a) => got.push(a)), false);
  assert.deepEqual(got, []);
});

test("a step says what it waits for from its own shape, not from the wording of a problem", () => {
  assert.deepEqual(stepNeed({ key: "send_email", input: {} }), { kind: "mailbox" });
  assert.equal(stepNeed({ key: "send_email", input: { mailboxId: "mbx_1" } }), undefined);
  assert.deepEqual(stepNeed({ key: "send_sms", input: {} }), { kind: "number" });
  assert.deepEqual(stepNeed({ key: "ai" }, undefined, "space"), { kind: "ai" });
  assert.equal(stepNeed({ key: "ai" }, undefined, "personal"), undefined);
  assert.deepEqual(stepNeed({ key: "google.gmail.send", input: {} }), { kind: "connector", service: "google" });
  assert.equal(stepNeed({ key: "google.gmail.send", input: { connectionId: "con_1" } }), undefined);
  assert.equal(stepNeed({ key: "wait", input: {} }), undefined);
});

function Asker({ need, into }: { need: ConnectNeed; into: (a: Connected | null) => void }): ReactElement {
  const door = useConnectInline();
  return <Pressable testID="ask" onPress={() => { void door?.open(need).then(into); }}><Text>{`door ${door ? "yes" : "no"}`}</Text></Pressable>;
}

function Flow({ onDone, onCancel }: { onDone(a: Connected): void; onCancel(): void }): ReactElement {
  return (
    <>
      <Pressable testID="flow-finish" onPress={() => onDone(made)}><Text>Finish</Text></Pressable>
      <Pressable testID="flow-close" onPress={onCancel}><Text>Close</Text></Pressable>
    </>
  );
}

test("the host opens the flow over the page and resolves the picker's promise when it finishes", async () => {
  const restore = installDom();
  try {
    const results: (Connected | null)[] = [];
    const seen: string[] = [];
    const root = await mount(createRoot, (
      <ConnectInlineHost rt={null} onConnected={(need, a) => seen.push(`${need.kind}:${a.id}`)} render={({ onDone, onCancel }) => <Flow onDone={onDone} onCancel={onCancel} />}>
        <Asker need={{ kind: "mailbox" }} into={(a) => results.push(a)} />
      </ConnectInlineHost>
    ));
    assert.equal(find(root, "flow-finish"), null, "no flow until asked");
    await press(find(root, "ask"));
    assert.ok(find(root, "flow-finish"), "the flow is open over the page");
    assert.ok(textOf(root).includes("door yes"), "the page underneath is still there");
    await press(find(root, "flow-finish"));
    await flush();
    assert.equal(find(root, "flow-finish"), null, "the flow closes");
    assert.deepEqual(results, [made]);
    assert.deepEqual(seen, ["mailbox:mbx_new"]);
    await press(find(root, "ask"));
    await press(find(root, "flow-close"));
    await flush();
    assert.deepEqual(results, [made, null], "closing without finishing hands back nothing");
  } finally { restore(); }
});

test("without a host there is no door, so no picker draws a Connect item", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Asker need={{ kind: "ai" }} into={() => undefined} />);
    assert.ok(textOf(root).includes("door no"));
  } finally { restore(); }
});
