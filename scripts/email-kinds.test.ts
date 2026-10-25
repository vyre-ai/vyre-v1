// Heading and footer are first-class email block kinds (P-CC_23).

import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL_BLOCK_KINDS, emailBlockHtml } from "./props.ts";
import type { EmailBlock } from "./props.ts";

test("heading and footer are frozen block kinds", () => {
  assert.equal(EMAIL_BLOCK_KINDS.includes("heading"), true);
  assert.equal(EMAIL_BLOCK_KINDS.includes("footer"), true);
});

test("heading exports an h1 at its size and alignment", () => {
  const block: EmailBlock = { id: "b1", kind: "heading", text: "Join us <Thursday>", size: 30, align: "center" };
  const html = emailBlockHtml(block) ?? "";
  assert.match(html, /^<h1 /);
  assert.match(html, /700 30px/);
  assert.match(html, /text-align:center/);
  assert.match(html, /Join us &lt;Thursday&gt;/);
  assert.match(emailBlockHtml({ id: "b2", kind: "heading", text: "x" }) ?? "", /700 24px/);
});

test("footer exports the unsubscribe and preferences links only when unsub is on", () => {
  const on = emailBlockHtml({ id: "f1", kind: "footer", text: "Northwind", unsub: true }) ?? "";
  assert.match(on, /\{\{unsubscribe_url\}\}/);
  assert.match(on, /\{\{preferences_url\}\}/);
  const off = emailBlockHtml({ id: "f2", kind: "footer", text: "Northwind" }) ?? "";
  assert.equal(off.includes("unsubscribe_url"), false);
  assert.equal(emailBlockHtml({ id: "t1", kind: "text", text: "hi" }), null);
});
