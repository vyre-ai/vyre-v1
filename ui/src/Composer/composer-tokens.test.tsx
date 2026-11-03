// The @mention wash behind the composer field (owner report, rc.16 on MLA: the @Assistant box sat right of and below its word). The wash is a copy of the field's text drawn behind it, so it
// must lay out exactly as the field does: the same box (padding) in every layout, the same font size and line height, and the same wrapping.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { StyleSheet, View } from "react-native";
import { Composer } from "./index.tsx";

const lists = { agents: [{ t: "Assistant" }], people: [] } as never;
const TEXT = "@Assistant can you draft the reply to the long thread from this morning about the estate plan and the trust, please";

/** The class names of the first element carrying `attr`. React Native Web writes each style as an atomic class (`r-paddingTop-<hash of the value>`), so equal classes are equal values. */
function classesOf(html: string, attr: string): string[] {
  const at = html.indexOf(attr);
  assert.ok(at >= 0, `${attr} is drawn`);
  const open = html.lastIndexOf("<", at);
  const tag = html.slice(open, html.indexOf(">", at));
  return (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);
}
const pick = (cls: readonly string[], prop: RegExp): string[] => cls.filter((c) => prop.test(c)).sort();
/** The classes of a box laid over its parent at 0 on the left, right and top. */
const ZERO = StyleSheet.create({ box: { position: "absolute", left: 0, right: 0, top: 0 } });
const AT_ZERO = pick(classesOf(renderToStaticMarkup(<View testID="zero" style={ZERO.box} />), 'data-testid="zero"'), /^r-(left|right|top)-/);

for (const [name, props] of [
  ["the one-line pill", {}],
  ["the regular two-row field (an email)", { sendsOutside: true, recipients: null }],
  ["the compact field", { sendsOutside: true, recipients: null, density: "compact" as const }],
] as const) {
  test(`${name}: the mention wash takes the field's own box, font size, line height and wrapping`, () => {
    const html = renderToStaticMarkup(<Composer whoWillAnswer="Assistant will reply" lists={lists} value={TEXT} {...props} />);
    assert.ok(html.includes('data-testid="composer-token-mention"'), "the mention is washed");
    const wrap = classesOf(html, 'data-cmp-field="1"');
    const wash = classesOf(html, 'data-testid="composer-tokens"');
    const PAD = /^r-padding/;
    assert.ok(pick(wrap, PAD).length > 0, "the field's box has padding");
    assert.deepEqual(pick(wash, PAD), pick(wrap, PAD), "the same padding as the field's box, so the wash starts where the text starts");
    assert.equal(AT_ZERO.length, 3);
    assert.deepEqual(pick(wash, /^r-(left|right|top)-/), AT_ZERO, "laid over the whole box at 0, not inset a second time");
    const field = classesOf(html, 'data-testid="composer-field"');
    const ghost = classesOf(html, 'data-cmp-ghost="1"');
    assert.deepEqual(pick(ghost, /^r-(fontSize|lineHeight)-/), pick(field, /^r-(fontSize|lineHeight)-/), "the same font size and line height as the field");
    assert.ok(ghost.some((c) => c.startsWith("r-whiteSpace-")), "wraps as the field does");
  });
}
