// ui/Card: the parts, the fixed action order, the keyboard, and the reserved error line.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { Card, CardActions, CardBody, CardDeny, CardDone, CardField, CardFields, CardHead, CardRow, CARD_WIDTH, keyHandler } from "./index.tsx";

const noop = (): void => {};

test("a card is a labelled summary with its head, fields, body and actions", () => {
  const html = renderToStaticMarkup(
    <Card kind="decision" label="Dex wants to edit Q4" testID="c">
      <CardHead title="Dex wants to edit Q4" meta="Sends at 9:00" />
      <CardFields><CardRow label="To">Aliza</CardRow></CardFields>
      <CardBody><Text>Body words</Text></CardBody>
      <CardActions primary={{ label: "Allow", onPress: noop }} secondary={[{ label: "Deny", onPress: noop }]} />
    </Card>,
  );
  assert.match(html, /role="group"|role="summary"|aria-label="Dex wants to edit Q4"/);
  for (const t of ["Dex wants to edit Q4", "Sends at 9:00", "To", "Aliza", "Body words", "Allow", "Deny"]) assert.ok(html.includes(t), t);
});

test("a status error card is an alert; the other kinds are not", () => {
  assert.match(renderToStaticMarkup(<Card kind="status" tone="error" label="E" />), /role="alert"/);
  assert.doesNotMatch(renderToStaticMarkup(<Card kind="decision" label="D" />), /role="alert"/);
});

test("the primary comes first, then the secondary actions in the order given, the deny last", () => {
  const html = renderToStaticMarkup(<CardActions primary={{ label: "Allow", onPress: noop }} secondary={[{ label: "Always allow", onPress: noop }, { label: "Deny", onPress: noop }]} />);
  assert.ok(html.indexOf(">Allow<") < html.indexOf(">Always allow<"));
  assert.ok(html.indexOf(">Always allow<") < html.indexOf(">Deny<"));
});

test("a busy card disables every action and keeps the labels", () => {
  const html = renderToStaticMarkup(<CardActions busy primary={{ label: "Allow", onPress: noop, testID: "go" }} secondary={[{ label: "Deny", onPress: noop, testID: "no" }]} />);
  for (const id of ["go", "no"]) {
    const at = html.indexOf(`data-testid="${id}"`);
    const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at));
    assert.match(tag, /disabled/, id);
  }
  assert.ok(html.includes(">Allow<") && html.includes(">Deny<"), "labels do not change while busy");
  assert.match(html, /data-card-ring/);
});

test("an action error is an alert under the row", () => {
  const html = renderToStaticMarkup(<CardActions primary={{ label: "Allow", onPress: noop }} error="Already decided." />);
  assert.match(html, /role="alert"[^>]*>Already decided\./);
});

test("a field keeps one line under it whether it shows a hint, an error or nothing", async () => {
  const none = renderToStaticMarkup(<CardField label="Key" value="" onChange={noop} />);
  const hint = renderToStaticMarkup(<CardField label="Key" value="" onChange={noop} hint="Starts with sk-" />);
  const bad = renderToStaticMarkup(<CardField label="Key" value="x" onChange={noop} error="That is not a key" />);
  assert.ok(hint.includes("Starts with sk-"));
  assert.match(bad, /role="alert"[^>]*>That is not a key/);
  assert.match(bad, /aria-invalid="true"/);
  // the under line exists in all three, so the card does not change height; its least height is in the source
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("./index.tsx", import.meta.url), "utf8"), /under: \{ minHeight: 16/);
  for (const h of [none, hint, bad]) assert.match(h, /-webkit-line-clamp:2/);
});

test("the reason step has Back, the confirming Deny, and the reason field", () => {
  const html = renderToStaticMarkup(<CardDeny ids={{ reason: "d-reason", back: "d-back", go: "d-go" }} onDeny={noop} onBack={noop} />);
  assert.match(html, /data-testid="d-reason"/);
  assert.match(html, /data-testid="d-back"/);
  assert.match(html, /data-testid="d-go"/);
  assert.ok(html.indexOf(">Deny<") < html.indexOf(">Back<"));
});

test("a done line is one line of text", () => {
  const html = renderToStaticMarkup(<CardDone text="Sent to Aliza" testID="x" />);
  assert.ok(html.includes("Sent to Aliza"));
});

test("full is 560 wide and compact 420", () => {
  assert.equal(CARD_WIDTH.full, 560);
  assert.equal(CARD_WIDTH.compact, 420);
  assert.match(renderToStaticMarkup(<Card kind="item" label="I" size="compact" />), /max-width:\s*420px|r-maxWidth/);
});

test("Enter runs the primary, Escape the way out; a button and a multi-line field keep their Enter", () => {
  const calls: string[] = [];
  const h = keyHandler(() => calls.push("enter"), () => calls.push("esc"))!;
  h({ key: "Enter", target: { tagName: "INPUT" } });
  h({ key: "Escape", target: { tagName: "INPUT" } });
  h({ key: "Enter", target: { tagName: "BUTTON" } });
  h({ key: "Enter", target: { tagName: "TEXTAREA" } });
  h({ key: "Enter", target: { tagName: "TEXTAREA" }, metaKey: true });
  h({ key: "Enter", target: { tagName: "DIV", isContentEditable: true } });
  h({ key: "a", target: { tagName: "INPUT" } });
  assert.deepEqual(calls, ["enter", "esc", "enter"]);
  assert.equal(keyHandler(undefined, undefined), undefined);
});

test("only the card's own source uses the library tokens: no raw colours", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /#[0-9a-fA-F]{3,6}\b|rgba?\(/);
});

test("one radius for the card, its fields and its buttons, from the token; buttons are 32 high and 44 on a phone; no card edge", async () => {
  const { readFileSync } = await import("node:fs");
  const { RADIUS } = await import("../tokens/radius.ts");
  assert.equal(RADIUS, 12);
  const src = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  for (const k of ["card", "body", "input", "btn"]) assert.match(src, new RegExp(`  ${k}: \\{[^\\n]*borderRadius: RADIUS`), k);
  assert.match(src, /btn: \{ height: 32,/);
  assert.match(src, /btnTall: \{ height: 44 \}/);
  assert.doesNotMatch(src, /  card: \{[^\n]*borderWidth/);
});
