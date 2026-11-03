// The @mention wash behind the composer field (owner report, rc.16 on MLA: the @Assistant box sat right of and below its word). The wash is a copy of the field's text drawn behind it, so it
// must lay out exactly as the field does: the same box (padding) in every layout, the same font size and line height, and the same wrapping.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "./index.tsx";

const lists = { agents: [{ t: "Assistant" }], people: [] } as never;
const TEXT = "@Assistant can you draft the reply to the long thread from this morning about the estate plan and the trust, please";

/** The inline style of the first element carrying `attr`, as a map. */
function styleOf(html: string, attr: string): Record<string, string> {
  const at = html.indexOf(attr);
  assert.ok(at >= 0, `${attr} is drawn`);
  const open = html.lastIndexOf("<", at);
  const tag = html.slice(open, html.indexOf(">", at));
  const style = /style="([^"]*)"/.exec(tag)?.[1] ?? "";
  return Object.fromEntries(style.split(";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));
}
const PAD = ["padding-top", "padding-right", "padding-bottom", "padding-left"];
const padOf = (st: Record<string, string>): string[] => PAD.map((k) => st[k] ?? "0px");

for (const [name, props] of [
  ["the one-line pill", {}],
  ["the regular two-row field (an email)", { sendsOutside: true, recipients: null }],
  ["the compact field", { sendsOutside: true, recipients: null, density: "compact" as const }],
] as const) {
  test(`${name}: the mention wash takes the field's own box, font size, line height and wrapping`, () => {
    const html = renderToStaticMarkup(<Composer whoWillAnswer="Assistant will reply" lists={lists} value={TEXT} {...props} />);
    assert.ok(html.includes('data-testid="composer-token-mention"'), "the mention is washed");
    const wrap = styleOf(html, 'data-cmp-field="1"');
    const wash = styleOf(html, 'data-testid="composer-tokens"');
    assert.deepEqual(padOf(wash), padOf(wrap), "the same padding as the field's box, so the wash starts where the text starts");
    assert.deepEqual([wash["left"], wash["right"], wash["top"]], ["0px", "0px", "0px"], "laid over the whole box, not inset a second time");
    const field = styleOf(html, 'data-testid="composer-field"');
    const ghost = styleOf(html, 'data-cmp-ghost="1"');
    assert.equal(ghost["font-size"], field["font-size"]);
    assert.equal(ghost["line-height"], field["line-height"]);
    assert.equal(ghost["white-space"], "pre-wrap");
  });
}
