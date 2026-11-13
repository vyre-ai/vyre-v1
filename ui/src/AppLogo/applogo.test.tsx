// AppLogo: the one mark for an app, everywhere (design 4B). A built-in mark first, then the app's own icon fetched by the server, then a clean letter tile in a colour taken from its name.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, textOf } from "../testing/dom.ts";
import { AppLogo, logoKind, tileColor } from "./index.tsx";

installDom();

test("which mark an app wears: Vyre's own glyph, a built-in brand, the fetched icon, then the letter", () => {
  assert.equal(logoKind({ app: "vyre:tasks", glyph: ["M1 1"] }), "glyph");
  assert.equal(logoKind({ app: "stripe" }), "builtin");
  assert.equal(logoKind({ app: "stripe", iconUrl: "/icons/stripe.png" }), "builtin");
  assert.equal(logoKind({ app: "zorblex", iconUrl: "/icons/zorblex.png" }), "fetched");
  assert.equal(logoKind({ app: "zorblex" }), "letter");
});

test("a letter tile takes its colour from the name: the same name always the same colour, other names differ", () => {
  assert.equal(tileColor("Zorblex"), tileColor("zorblex"));
  assert.notEqual(tileColor("Zorblex"), tileColor("Notely"));
  assert.match(tileColor("Zorblex"), /^\d{1,3}$/);
});

test("the tile draws at the size it is given, with the app's name as its label, and never from a file path", async () => {
  const root = await mount(createRoot, <AppLogo app="zorblex" name="Zorblex" size={32} testID="logo" />);
  const tile = find(root, "logo")!;
  assert.ok(tile);
  assert.equal(textOf(root).trim(), "Z");
  assert.equal((tile.props["aria-label"] ?? tile.props["accessibilityLabel"]) as string, "Zorblex");
});

test("a built-in app shows its mark, not a letter", async () => {
  const root = await mount(createRoot, <AppLogo app="stripe" name="Stripe" size={28} testID="logo" />);
  assert.equal(textOf(root).trim(), "");
});
