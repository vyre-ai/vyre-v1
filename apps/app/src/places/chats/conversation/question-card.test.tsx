// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionCard, radioKey } from "./question-card.tsx";

test("radio keys: arrows move and wrap, Home and End jump, Space and Enter choose, Tab is left alone", () => {
  assert.deepEqual(radioKey("ArrowDown", 0, 3), { move: 1 });
  assert.deepEqual(radioKey("ArrowDown", 2, 3), { move: 0 });
  assert.deepEqual(radioKey("ArrowUp", 0, 3), { move: 2 });
  assert.deepEqual(radioKey("Home", 2, 3), { move: 0 });
  assert.deepEqual(radioKey("End", 0, 3), { move: 2 });
  assert.deepEqual(radioKey(" ", 1, 3), { choose: true });
  assert.deepEqual(radioKey("Enter", 1, 3), { choose: true });
  assert.equal(radioKey("Tab", 1, 3), null);
});

test("the answers are radios with one tab stop, in a radio group", () => {
  const html = renderToStaticMarkup(
    <QuestionCard
      id="q"
      prompt="Which?"
      options={[
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ]}
      onAnswer={() => undefined}
    />,
  );
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.equal(
    (html.match(/role="radio"[^>]*tabindex="0"|tabindex="0"[^>]*role="radio"/g) ?? []).length,
    1,
    "one tab stop",
  );
  assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 2);
  assert.ok(html.includes('role="radiogroup"') && !/role="button"[^>]*option-q/.test(html));
});
