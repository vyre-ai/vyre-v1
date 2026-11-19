// The strip and the card of a Vyre document page: what they say and which buttons they offer (the page itself is TipTap in a browser).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeCard, DocBar } from "../ui/src/RichEditor/doc/DocBar.tsx";
import { MarkdownEditor } from "../ui/src/RichEditor/MarkdownEditor.tsx";

const noop = (): void => {};
const bar = (o: Partial<Parameters<typeof DocBar>[0]> = {}): string =>
  renderToStaticMarkup(
    <DocBar
      canSuggest
      suggesting={false}
      onSuggesting={noop}
      hasFields
      onField={noop}
      count={0}
      onPrev={noop}
      onNext={noop}
      onAcceptAll={noop}
      onRejectAll={noop}
      canResolve
      {...o}
    />,
  );

test("the strip offers Editing or Suggesting and Field; with no suggestions there is no review", () => {
  const html = bar();
  assert.match(html, /doc-mode-editing/);
  assert.match(html, /doc-mode-suggesting/);
  assert.match(html, /doc-field/);
  assert.doesNotMatch(html, /doc-review/);
});

test("with suggestions it says how many and offers previous, next, Accept all and Reject all", () => {
  const html = bar({ count: 3 });
  assert.match(html, /3 suggestions/);
  for (const id of ["doc-prev", "doc-next", "doc-accept-all", "doc-reject-all"]) assert.match(html, new RegExp(id));
  assert.match(bar({ count: 1 }), /1 suggestion</);
});

test("someone who may not edit can look through suggestions but not settle them", () => {
  const html = bar({ count: 2, canResolve: false, canSuggest: false, hasFields: false });
  assert.match(html, /doc-next/);
  assert.doesNotMatch(html, /doc-accept-all|doc-reject-all|doc-mode/);
});

test("nothing to show draws nothing", () => {
  assert.equal(bar({ canSuggest: false, hasFields: false, count: 0 }), "");
});

test("the card on a suggestion says who, when and what, and offers Accept and Reject", () => {
  const html = renderToStaticMarkup(
    <ChangeCard
      change={{
        kind: "sub",
        from: 1,
        to: 9,
        mid: 5,
        author: "Agent",
        at: "2026-11-19T10:00:00Z",
        old: "world",
        added: "planet",
      }}
      left={10}
      top={20}
      canResolve
      onAccept={noop}
      onReject={noop}
    />,
  );
  assert.match(html, /Agent/);
  assert.match(html, /“world” to “planet”/);
  assert.match(html, /doc-change-accept/);
  assert.match(html, /doc-change-reject/);
});

test("a document page in read mode is the page, not the plain text renderer", () => {
  const html = renderToStaticMarkup(
    <MarkdownEditor value={"Hi {client.name}\n"} label="Document" mode="read" doc={{}} />,
  );
  assert.match(html, /markdown-editor/);
  assert.doesNotMatch(html, /md-bar/);
});
