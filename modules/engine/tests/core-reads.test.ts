// The reads a question about the Inbox or a mail thread starts with are listed in every turn (CORE_READ_TOOLS), not left to tool_search. They must exist as tools, and not already be in the frozen default
// list (or the preload would be a no-op and this test would not be needed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CORE_READ_TOOLS } from "../api-tools.ts";

test("every core read is a real tool, and each would otherwise have to be found with tool_search", () => {
  const tools = new Set((JSON.parse(readFileSync(new URL("../../../generated/mcp-tools.json", import.meta.url), "utf8")) as { tools: Array<{ name: string }> }).tools.map((t) => t.name));
  const frozen = readFileSync(new URL("../../../docs/frozen/agent-tools.md", import.meta.url), "utf8");
  for (const n of CORE_READ_TOOLS) {
    assert.ok(tools.has(n), `${n} is a tool`);
    assert.ok(!new RegExp("`" + n + "`").test(frozen), `${n} is not in the frozen default list`);
  }
  for (const n of ["inbox_counts", "inbox_list_by_thread", "mail_thread_get"]) assert.ok(CORE_READ_TOOLS.includes(n), n);
});
