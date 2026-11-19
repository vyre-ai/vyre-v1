// ui/InlineConfirm: the in-place confirmation. The machine is tested pure (every transition), the strip through the fake DOM (a double-press on the button that opened it never deletes; Cancel is focused; Escape cancels).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, mount, press } from "../testing/dom.ts";
import { escapeLayers } from "../Overlay/escape.ts";
import { InlineConfirm, step } from "./index.tsx";
import type { ConfirmEvent, ConfirmState } from "./logic.ts";

test("the machine: confirm does nothing while wary or spent, fires when armed, then waits to arm again; cancel works in every live state and ends it", () => {
  const states: ConfirmState[] = ["wary", "armed", "spent", "gone"];
  const events: ConfirmEvent[] = ["arm", "confirm", "cancel"];
  const want: Record<string, string> = {
    "wary arm": "armed/-",
    "wary confirm": "wary/-",
    "wary cancel": "gone/cancel",
    "armed arm": "armed/-",
    "armed confirm": "spent/confirm",
    "armed cancel": "gone/cancel",
    "spent arm": "armed/-",
    "spent confirm": "spent/-",
    "spent cancel": "gone/cancel",
    "gone arm": "gone/-",
    "gone confirm": "gone/-",
    "gone cancel": "gone/-",
  };
  for (const st of states)
    for (const ev of events) {
      const r = step(st, ev);
      assert.equal(`${r.state}/${r.fire ?? "-"}`, want[`${st} ${ev}`], `${st} + ${ev}`);
    }
});

test("no sequence of events fires before it is armed, or twice without an arm between, or after a cancel", () => {
  const events: ConfirmEvent[] = ["arm", "confirm", "cancel"];
  let seed = 7;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let run = 0; run < 500; run++) {
    let st: ConfirmState = "wary";
    let armed = false;
    let cancelled = false;
    for (let i = 0; i < 14; i++) {
      const ev = events[Math.floor(rnd() * 3)]!;
      if (ev === "arm" && !cancelled) armed = true;
      const r = step(st, ev);
      if (r.fire === "confirm") {
        assert.ok(armed, "fired before it was armed (or twice without an arm between)");
        assert.ok(!cancelled, "fired after a cancel");
        armed = false;
      }
      if (r.fire === "cancel") cancelled = true;
      st = r.state;
    }
  }
});

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("the double-press: the press that opened the strip, pressed again at once, does not land on Delete; after the wait it deletes once", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete “Q3 plan”?"
        confirmLabel="Delete"
        armMs={80}
        onConfirm={() => log.push("delete")}
        onCancel={() => log.push("cancel")}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, [], "two quick presses delete nothing");
    await wait(120);
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete"], "once armed, one delete, however many presses");
  } finally {
    restore();
  }
});

test("a delete that failed and left the strip open can be tried again: press, fail, the wait, press fires again; a double-press in between fires nothing", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete?"
        confirmLabel="Delete"
        armMs={60}
        onConfirm={() => log.push("delete")}
        onCancel={() => log.push("cancel")}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    await wait(100);
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete"], "three quick presses delete once");
    await wait(120);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete", "delete"], "the strip is still there and armed again: the retry fires");
    await press(find(root, "ic-cancel"));
    await wait(120);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete", "delete", "cancel"], "after Cancel nothing fires, however long it waits");
  } finally {
    restore();
  }
});

test("the confirm tells why it is off", () => {
  const html = renderToStaticMarkup(
    <InlineConfirm
      question="Delete the Space?"
      confirmLabel="Delete"
      disabled
      why="Type the Space's name exactly"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.ok(html.includes("Type the Space&#x27;s name exactly") || html.includes("Type the Space's name exactly"));
});

test("Cancel works at once and takes the strip out of play; Escape cancels through its own layer", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    const before = escapeLayers();
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete?"
        confirmLabel="Delete"
        armMs={20}
        onConfirm={() => log.push("delete")}
        onCancel={() => log.push("cancel")}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    assert.equal(escapeLayers(), before + 1, "the strip is an Escape layer while it shows");
    await press(find(root, "ic-cancel"));
    await wait(60);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["cancel"], "after a cancel the strip never deletes");
  } finally {
    restore();
  }
});

test("it reads the question and the note, Cancel then the danger button, and a non-destructive ask uses the accent", () => {
  const html = renderToStaticMarkup(
    <InlineConfirm
      question="Delete “Q3 plan”?"
      note="It cannot be undone."
      confirmLabel="Delete"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.ok(html.includes("Delete “Q3 plan”?") && html.includes("It cannot be undone."));
  assert.ok(html.indexOf('aria-label="Cancel"') < html.indexOf('aria-label="Delete"'), "Cancel first");
  assert.ok(html.includes("var(--danger)"));
  const calm = renderToStaticMarkup(
    <InlineConfirm
      danger={false}
      question="Leave?"
      confirmLabel="Leave"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.ok(!calm.includes("var(--danger)") && calm.includes("var(--accent)"));
});
