// ui/Dialog: one card for every sheet that asks something.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { Dialog } from "./index.tsx";

const noop = (): void => {};

test("a dialog has a labelled dialog role, the title, the content and its actions", () => {
  const html = renderToStaticMarkup(<Dialog title="Delete the report" testID="dlg" veilTestID="veil" onClose={noop} actions={[{ label: "Cancel", onPress: noop, testID: "no" }, { label: "Delete", danger: true, onPress: noop, testID: "yes" }]}><Text>This cannot be undone.</Text></Dialog>);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="Delete the report"|aria-modal/);
  for (const t of ["Delete the report", "This cannot be undone.", "Cancel", "Delete"]) assert.ok(html.includes(t), t);
  assert.match(html, /data-testid="dlg"/);
  assert.match(html, /data-testid="veil"/);
});

test("the quiet actions sit left of the primary one", () => {
  const html = renderToStaticMarkup(<Dialog title="T" onClose={noop} actions={[{ label: "Save", primary: true, onPress: noop }, { label: "Cancel", onPress: noop }, { label: "Remove", danger: true, onPress: noop }]} />);
  assert.ok(html.indexOf(">Cancel<") < html.indexOf(">Save<"), "Cancel before Save");
  assert.ok(html.indexOf(">Cancel<") < html.indexOf(">Remove<"), "Cancel before Remove");
});

test("a disabled action is disabled", () => {
  const html = renderToStaticMarkup(<Dialog title="T" onClose={noop} actions={[{ label: "Send", primary: true, disabled: true, onPress: noop, testID: "go" }]} />);
  assert.match(html.slice(Math.max(0, html.indexOf('data-testid="go"') - 300), html.indexOf('data-testid="go"') + 80), /disabled/);
});
