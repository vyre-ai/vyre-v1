// The search field's keys reach the palette in the real web build. react-native-web replaces a TextInput's onKeyDown with its own handler and only calls onKeyPress,
// so a handler passed as onKeyDown was silently dropped: arrows and Enter did nothing. Driven through the host node's onKeyDown, the way a browser key press arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find } from "../../../../../ui/src/testing/dom.ts";
import { CmdKBody } from "./CmdK.tsx";
import { CmdKController } from "./controller.ts";
import { createSampleData } from "./sample.ts";

const keyEvent = (key: string, extra: Record<string, unknown> = {}) => {
  let prevented = false;
  return { key, ...extra, nativeEvent: { key, isComposing: false, ...extra }, target: { blur() {} }, currentTarget: { blur() {} }, preventDefault() { prevented = true; }, stopPropagation() {}, isDefaultPrevented: () => prevented, isPropagationStopped: () => false, persist() {} };
};

test("ArrowDown, ArrowUp, Enter and Cmd-Enter typed in the search field move and open the highlighted row", async () => {
  const restore = installDom();
  try {
    const c = new CmdKController(createSampleData().data);
    c.setRaw("referral");
    const moves: number[] = [];
    const chosen: Array<[number, boolean]> = [];
    const move = c.move.bind(c);
    c.move = (d: number) => { moves.push(d); move(d); };
    c.choose = (i?: number, newTab = false) => { chosen.push([i ?? -1, newTab]); };
    const root = await mount(createRoot, <CmdKBody controller={c} autoFocus={false} />);
    const press = async (key: string, extra: Record<string, unknown> = {}) => { await act(async () => { (find(root, "cmdk-input")!.props.onKeyDown as (e: unknown) => void)(keyEvent(key, extra)); }); };
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    assert.deepEqual(moves, [1, 1, -1], "the arrows move the highlight");
    await press("Enter");
    await press("Enter", { metaKey: true });
    assert.deepEqual(chosen.map(([, t]) => t), [false, true], "Enter opens, Cmd-Enter opens in a new tab");
    c.dispose();
  } finally { restore(); }
});
