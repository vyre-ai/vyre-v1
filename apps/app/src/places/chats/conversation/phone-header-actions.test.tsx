// The conversation on a phone: the header is the title and the member count (no agent chip), a message has no hover bar, and a long press opens its actions as a sheet. Click paths, not markup.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { Conversation } from "./Conversation.tsx";
import { createSample } from "./sample.ts";

const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });
const ids = (n: Node | string, out: string[] = []): string[] => { if (typeof n === "string") return out; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach((c) => ids(c, out)); return out; };

test("the phone header keeps the title and the member count and drops the agent chip; a desktop keeps the chip", async () => {
  installDom();
  for (const [width, chip] of [[390, false], [1280, true]] as const) {
    widen(width);
    const root = await mount(createRoot, <Conversation data={createSample("idle").data} />);
    assert.ok(find(root, "conversation-title") && find(root, "participants-button"), `${width}: title and count`);
    assert.equal(find(root, "face-agt_intake") !== null, chip, `${width} wide`);
  }
  widen(1280);
});

test("on a phone a message has no hover bar and a long press opens its actions as a sheet that runs them", async () => {
  installDom();
  widen(390);
  const copied: string[] = [];
  const data = createSample("idle").data;
  const root = await mount(createRoot, <Conversation data={{ ...data, copy: (t: string) => void copied.push(t) }} />);
  const all = ids(root);
  assert.ok(!all.some((i) => i.startsWith("hover-")), "no hover bar on a phone");
  const msg = all.find((i) => /^msg-/.test(i))!;
  const row = find(root, msg)!;
  assert.equal(row.props.tabIndex, undefined, "no focus ring from a tap");
  await act(async () => { (row.props.onTouchStart as () => void)(); await new Promise((r) => setTimeout(r, 520)); });
  await flush();
  assert.ok(find(root, "sheet-act-copy"), "the long press opened the sheet");
  await press(find(root, "sheet-act-copy"));
  await flush();
  assert.equal(copied.length, 1, "Copy ran");
  assert.equal(find(root, "sheet-act-copy"), null, "and the sheet closed");
  widen(1280);
});

test("a quick tap is not a long press", async () => {
  installDom();
  widen(390);
  const root = await mount(createRoot, <Conversation data={createSample("idle").data} />);
  const row = find(root, ids(root).find((i) => /^msg-/.test(i))!)!;
  await act(async () => { (row.props.onTouchStart as () => void)(); (row.props.onTouchEnd as () => void)(); await new Promise((r) => setTimeout(r, 520)); });
  await flush();
  assert.equal(find(root, "sheet-act-copy"), null);
  widen(1280);
});
