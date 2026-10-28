import test from "node:test";
import assert from "node:assert/strict";
import { serverBlock, visibleBlock } from "../src/places/apps/shell/email-design.ts";

test("visual columns, saved blocks, merge tokens, button URLs and HTML convert to real server blocks", () => {
  const blocks = [
    { id: "a", kind: "merge" as const, field: "first_name", text: "friend" },
    { id: "b", kind: "button" as const, text: "Read", href: "https://example.com" },
    { id: "c", kind: "html" as const, text: "<p>Hello</p>" },
  ];
  const columns = serverBlock({ id: "cols", kind: "columns", children: blocks });
  assert.equal((columns.props.cols as unknown[]).length, 3);
  const copied = visibleBlock(columns, "cols");
  assert.equal(copied.children?.[0].field, "first_name");
  assert.equal(copied.children?.[1].href, "https://example.com");
  assert.equal(copied.children?.[2].text, "<p>Hello</p>");
  assert.equal((serverBlock({ id: "saved", kind: "saved", children: [blocks[0]] }).props.block as { type: string }).type, "merge");
});
