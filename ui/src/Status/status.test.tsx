// ui/Status: a dot in the tone colour and a few words, one quiet note, one or two actions, a slot, rows. One look for something that runs, in a row, a block or a one-line bar.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { find, installDom, mount, press } from "../testing/dom.ts";
import { Status, TONE_COLOR } from "./index.tsx";

test("each tone paints its dot from a token and nothing else", () => {
  assert.deepEqual(TONE_COLOR, {
    ok: "var(--ok)",
    quiet: "var(--ink-4)",
    warn: "var(--warn)",
    bad: "var(--danger)",
    mine: "var(--accent)",
  });
  for (const [tone, token] of Object.entries(TONE_COLOR)) {
    const html = renderToStaticMarkup(<Status tone={tone as "ok"} label="Running" testID="s" />);
    assert.ok(html.includes(`background-color:${token}`), tone);
  }
});

test("a block draws the head, then the note, then the slot, then the rows", () => {
  const html = renderToStaticMarkup(
    <Status tone="warn" label="Waiting for room: 3 ahead" note="It starts by itself." slot={<Text>live view</Text>}>
      <Text>row one</Text>
    </Status>,
  );
  const at = (t: string): number => html.indexOf(t);
  assert.ok(at("Waiting for room: 3 ahead") >= 0 && at("Waiting for room: 3 ahead") < at("It starts by itself."));
  assert.ok(at("It starts by itself.") < at("live view") && at("live view") < at("row one"));
});

test("inline is only the dot and the words", () => {
  const html = renderToStaticMarkup(
    <Status tone="ok" label="Signed" note="hidden note" inline action={{ label: "Open", onPress: () => undefined }} />,
  );
  assert.ok(html.includes("Signed"));
  assert.ok(!html.includes("hidden note") && !html.includes("Open"));
});

test("bar is one line: the dot, the note, and at most one action", () => {
  const html = renderToStaticMarkup(
    <Status
      tone="mine"
      label="Dana has the keyboard"
      note="Dana has the keyboard"
      bar
      action={{ label: "Take control", onPress: () => undefined }}
    />,
  );
  assert.ok(html.includes("Dana has the keyboard") && html.includes("Take control"));
  assert.match(html, /role="status"/);
});

test("an action and a second action are both drawn, side by side, and a disabled one says why", () => {
  const html = renderToStaticMarkup(
    <Status
      tone="bad"
      label="Not sent"
      action={{ label: "Send again", onPress: () => undefined }}
      alt={{ label: "It went through", onPress: () => undefined, disabled: true, why: "Wait for the check" }}
    />,
  );
  assert.ok(html.indexOf("Send again") >= 0 && html.indexOf("Send again") < html.indexOf("It went through"));
  assert.match(
    html,
    /title="Wait for the check"/,
    "the reason reaches the page on a wrapper that still takes pointer and focus",
  );
  const tag = html.match(/<div[^>]*data-testid="status-alt"[^>]*>/)![0];
  assert.ok(
    !/disabled=""|tabindex="-1"/.test(tag),
    "a disabled action is still focusable and reachable by the pointer",
  );
  assert.match(tag, /aria-disabled="true"/);
});

test("the actions press, a disabled one does not, and the head is not a button", async () => {
  const restore = installDom();
  try {
    const seen: string[] = [];
    const root = await mount(
      createRoot,
      <Status
        tone="bad"
        label="Failed"
        testID="s"
        action={{ label: "Retry", onPress: () => void seen.push("retry") }}
        alt={{ label: "Discard", onPress: () => void seen.push("discard"), disabled: true }}
      />,
    );
    await press(find(root, "s-action"));
    const alt = find(root, "s-alt");
    if (alt && typeof alt.props["onClick"] === "function") await press(alt);
    assert.deepEqual(seen, ["retry"]);
    assert.equal(find(root, "s-head")!.props["role"], undefined, "the head is not a button");
  } finally {
    restore();
  }
});

test("a menu opens on right-click of the head", async () => {
  const restore = installDom();
  try {
    const withMenu = await mount(
      createRoot,
      <Status tone="ok" label="Running" testID="s" menu={[{ label: "Stop", onSelect: () => undefined }]} />,
    );
    assert.equal(typeof find(withMenu, "s-head")!.props["onContextMenu"], "function");
    const without = await mount(createRoot, <Status tone="ok" label="Running" testID="s" />);
    assert.equal(find(without, "s-head")!.props["onContextMenu"], undefined);
  } finally {
    restore();
  }
});
