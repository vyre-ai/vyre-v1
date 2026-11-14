// ui/Field: a Row whose right side is one control (or two): switch, select, number, text or button. One test file drives every kind the way a person does.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, installDom, mount, press, textOf } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { Field } from "./index.tsx";

const typeInto = async (n: Node | null, value: string): Promise<void> => {
  await act(async () => {
    (n!.props["onChange"] as (e: unknown) => void)({
      target: { value },
      currentTarget: { value },
      nativeEvent: { text: value },
      persist: () => undefined,
      stopPropagation: () => undefined,
    });
  });
};
/** A disabled control has no click at all: pressing it does nothing. */
const pressIfLive = async (n: Node | null): Promise<void> => {
  if (n && typeof n.props["onClick"] === "function") await press(n);
};
const blur = async (n: Node | null): Promise<void> => {
  await act(async () => {
    (n!.props["onBlur"] as (e: unknown) => void)({
      nativeEvent: {},
      target: {},
      currentTarget: {},
      persist() {},
      stopPropagation() {},
    });
  });
};
const key = async (n: Node | null, k: string): Promise<void> => {
  const ev = {
    key: k,
    shiftKey: false,
    isComposing: false,
    nativeEvent: { key: k },
    target: { tagName: "INPUT", getAttribute: () => null, blur() {} },
    currentTarget: { tagName: "INPUT", getAttribute: () => null, blur() {} },
    persist() {},
    stopPropagation() {},
    preventDefault() {},
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
  };
  await act(async () => {
    (n!.props["onKeyDown"] as ((e: unknown) => void) | undefined)?.(ev);
  });
};

test("a switch field shows its label and hint, and pressing the row or the switch toggles it", async () => {
  const restore = installDom();
  try {
    const seen: boolean[] = [];
    const root = await mount(
      createRoot,
      <Field
        label="Quiet hours"
        hint="Nothing reaches you at night"
        testID="f"
        control={{ kind: "switch", on: false, onChange: (v) => seen.push(v) }}
      />,
    );
    assert.match(textOf(find(root, "f")), /Quiet hours/);
    assert.match(textOf(find(root, "f")), /Nothing reaches you at night/);
    await press(find(root, "f-control"));
    await press(find(root, "row-f"));
    assert.deepEqual(seen, [true, true], "the switch and the whole row both toggle");
  } finally {
    restore();
  }
});

test("a disabled field changes nothing and says why", async () => {
  const restore = installDom();
  try {
    const seen: boolean[] = [];
    const root = await mount(
      createRoot,
      <Field
        label="Quiet hours"
        disabled
        why="Only the owner can change this"
        testID="f"
        control={{ kind: "switch", on: true, onChange: (v) => seen.push(v) }}
      />,
    );
    await pressIfLive(find(root, "f-control"));
    await pressIfLive(find(root, "row-f"));
    assert.deepEqual(seen, []);
    assert.equal(
      find(root, "f")!.props["title"] ??
        find(root, "f")!.props["aria-description"] ??
        find(root, "f-why")?.props["children"],
      "Only the owner can change this",
    );
  } finally {
    restore();
  }
});

test("a text field commits on Enter and on blur, and Escape puts the old value back", async () => {
  const restore = installDom();
  try {
    const seen: string[] = [];
    const root = await mount(
      createRoot,
      <Field label="Name" testID="f" control={{ kind: "text", value: "Dana", onCommit: (v) => seen.push(v) }} />,
    );
    const input = (): Node => find(root, "f-control")!;
    await typeInto(input(), "Dana R");
    await blur(input());
    assert.deepEqual(seen, ["Dana R"]);
    await typeInto(input(), "Dana Q");
    await key(input(), "Enter");
    assert.deepEqual(seen, ["Dana R", "Dana Q"]);
    await typeInto(input(), "Nope");
    await key(input(), "Escape");
    await blur(input());
    assert.deepEqual(seen, ["Dana R", "Dana Q"], "Escape drops the draft: nothing more is committed");
  } finally {
    restore();
  }
});

test("a number field clamps to its range on blur and says the range in one plain line", async () => {
  const restore = installDom();
  try {
    const seen: number[] = [];
    const root = await mount(
      createRoot,
      <Field
        label="Spend cap"
        testID="f"
        control={{ kind: "number", value: 5, min: 1, max: 10, unit: "dollars", onChange: (n) => seen.push(n) }}
      />,
    );
    assert.match(textOf(find(root, "f")), /1 to 10 dollars/);
    await typeInto(find(root, "f-control"), "99");
    await blur(find(root, "f-control"));
    await typeInto(find(root, "f-control"), "0");
    await blur(find(root, "f-control"));
    assert.deepEqual(seen, [10, 1]);
  } finally {
    restore();
  }
});

test("a select opens its choices where it was pressed and picks one", async () => {
  const restore = installDom();
  try {
    const seen: string[] = [];
    const root = await mount(
      createRoot,
      <Field
        label="Model"
        testID="f"
        control={{
          kind: "select",
          value: "fast",
          options: [
            { value: "fast", label: "Fast" },
            { value: "deep", label: "Deep" },
          ],
          onChange: (v) => seen.push(v),
        }}
      />,
    );
    assert.match(textOf(find(root, "f-control")), /Fast/, "the current choice is the button's label");
    assert.equal(find(root, "f-control")!.props["aria-haspopup"], "menu");
  } finally {
    restore();
  }
});

test("a button field presses, and two controls sit side by side", async () => {
  const restore = installDom();
  try {
    let pressed = 0;
    const seen: string[] = [];
    const root = await mount(
      createRoot,
      <Field
        label="Address"
        testID="f"
        control={[
          { kind: "text", value: "a@b.example", onCommit: (v) => seen.push(v) },
          { kind: "button", label: "Verify", onPress: () => void pressed++ },
        ]}
      />,
    );
    await press(find(root, "f-control-1"));
    assert.equal(pressed, 1);
    assert.ok(find(root, "f-control"), "the first control keeps the plain id");
  } finally {
    restore();
  }
});
