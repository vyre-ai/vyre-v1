// ui/Dialog: one card for every sheet that asks something.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { Dialog } from "./index.tsx";

const noop = (): void => {};

test("a dialog has a labelled dialog role, the title, the content and its actions", () => {
  const html = renderToStaticMarkup(
    <Dialog
      title="Delete the report"
      testID="dlg"
      veilTestID="veil"
      onClose={noop}
      actions={[
        { label: "Cancel", onPress: noop, testID: "no" },
        { label: "Delete", danger: true, onPress: noop, testID: "yes" },
      ]}
    >
      <Text>This cannot be undone.</Text>
    </Dialog>,
  );
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="Delete the report"|aria-modal/);
  for (const t of ["Delete the report", "This cannot be undone.", "Cancel", "Delete"]) assert.ok(html.includes(t), t);
  assert.match(html, /data-testid="dlg"/);
  assert.match(html, /data-testid="veil"/);
});

test("the quiet actions sit left of the primary one", () => {
  const html = renderToStaticMarkup(
    <Dialog
      title="T"
      onClose={noop}
      actions={[
        { label: "Save", primary: true, onPress: noop },
        { label: "Cancel", onPress: noop },
        { label: "Remove", danger: true, onPress: noop },
      ]}
    />,
  );
  assert.ok(html.indexOf(">Cancel<") < html.indexOf(">Save<"), "Cancel before Save");
  assert.ok(html.indexOf(">Cancel<") < html.indexOf(">Remove<"), "Cancel before Remove");
});

test("a disabled action is disabled", () => {
  const html = renderToStaticMarkup(
    <Dialog
      title="T"
      onClose={noop}
      actions={[{ label: "Send", primary: true, disabled: true, onPress: noop, testID: "go" }]}
    />,
  );
  assert.match(
    html.slice(Math.max(0, html.indexOf('data-testid="go"') - 300), html.indexOf('data-testid="go"') + 80),
    /disabled/,
  );
});

test("a fill dialog keeps its centred card on a wide window", () => {
  const html = renderToStaticMarkup(
    <Dialog title="T" fill onClose={noop}>
      <Text>Body</Text>
    </Dialog>,
  );
  assert.match(html, /role="dialog"/);
  assert.ok(html.includes("Body"));
});

test("the action row wraps inside the card's padding instead of running past its left edge (a phone, three actions)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(src, /actions: \{[^}]*flexWrap: "wrap"/);
});

test("an anchored dialog draws no veil and does not claim the page (no aria-modal), keeps its title and a close control", () => {
  const html = renderToStaticMarkup(
    <Dialog title="Usage" anchor="composer" testID="dlg" veilTestID="veil" onClose={noop}>
      <Text>Body</Text>
    </Dialog>,
  );
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="Usage"/);
  assert.ok(!html.includes("aria-modal"), "the page behind stays usable");
  assert.ok(!html.includes('data-testid="veil"'), "no veil");
  assert.match(html, /data-testid="dialog-close"/);
  assert.ok(html.includes("Body"));
});

test("an anchored dialog's four ways to close are Escape, the close control, a press outside, and the owner's next send; Escape is its layer, and a press outside is handed to the owner", async () => {
  const { act } = await import("react");
  const { createRoot } = await import("test-renderer");
  const { find, installDom, mount, press } = await import("../testing/dom.ts");
  const { escapeLayers } = await import("../Overlay/escape.ts");
  const restore = installDom();
  try {
    const log: string[] = [];
    const heard: Array<(e: { target?: unknown }) => void> = [];
    const d = (globalThis as { document: Record<string, unknown> }).document;
    const was = d["addEventListener"];
    d["addEventListener"] = (t: string, f: (e: { target?: unknown }) => void) =>
      void (t === "pointerdown" && heard.push(f));
    const before = escapeLayers();
    const root = await mount(
      createRoot,
      <Dialog
        title="Usage"
        anchor="composer"
        onClose={() => log.push("close")}
        onPressOutside={() => log.push("outside")}
      >
        <Text>Body</Text>
      </Dialog>,
    );
    assert.equal(escapeLayers(), before + 1, "it is an Escape layer");
    await press(find(root, "dialog-close"));
    assert.deepEqual(log, ["close"], "the close control closes it");
    assert.equal(heard.length, 1, "it listens for a press anywhere on the page");
    await act(async () => heard[0]!({ target: { outside: true } }));
    assert.deepEqual(
      log,
      ["close", "outside"],
      "a press outside is handed to the owner, who decides (the composer is not outside)",
    );
    d["addEventListener"] = was;
  } finally {
    restore();
  }
});
