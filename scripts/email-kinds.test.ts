// Heading and footer are first-class email block kinds (P-CC_23).

import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL_BLOCK_KINDS, emailBlockHtml } from "../ui/src/EmailBuilder/props.ts";
import type { EmailBlock } from "../ui/src/EmailBuilder/props.ts";

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

test("spacer, social and saved are frozen kinds with their HTML export", () => {
  for (const k of ["spacer", "social", "saved"]) assert.equal(EMAIL_BLOCK_KINDS.includes(k as never), true);
  assert.match(emailBlockHtml({ id: "s1", kind: "spacer", size: 40 }) ?? "", /height:40px/);
  assert.match(emailBlockHtml({ id: "s2", kind: "spacer" }) ?? "", /height:24px/);
  assert.match(emailBlockHtml({ id: "s3", kind: "spacer", size: 5000 }) ?? "", /height:200px/);
  const so = emailBlockHtml({ id: "o1", kind: "social", align: "center", links: [{ network: "x", url: "https://x.com/acme" }, { network: "website", url: "javascript:alert(1)" }] }) ?? "";
  assert.match(so, /href="https:\/\/x\.com\/acme"/);
  assert.equal(so.includes("javascript"), false);
  assert.equal(emailBlockHtml({ id: "o2", kind: "social", links: [] }), "");
  const saved = emailBlockHtml({ id: "v1", kind: "saved", savedId: "blk_1", children: [{ id: "h", kind: "heading", text: "Hi", size: 30 }] }) ?? "";
  assert.match(saved, /<h1 [^>]*30px/);
  assert.equal(emailBlockHtml({ id: "v2", kind: "saved" }), "");
});
