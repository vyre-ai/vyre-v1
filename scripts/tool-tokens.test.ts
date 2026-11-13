// The size of what models are shown of their tools may only go down (13 Nov 2026). Lower the numbers in scripts/tool-tokens-baseline.json with `node scripts/tool-tokens.ts --write` when a cut makes them smaller;
// a tool or a description that grows them is red until it is cut or the growth is argued in the report.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { measure } from "./tool-tokens.ts";

const base = JSON.parse(readFileSync(new URL("./tool-tokens-baseline.json", import.meta.url), "utf8")) as Record<
  string,
  number
>;

test("what a model is shown of its tools is no larger than the recorded baseline", () => {
  const m = measure();
  assert.ok(
    m.all.now_api_slim.chars <= (base["api_slim_chars"] as number),
    `API view grew: ${m.all.now_api_slim.chars} > ${base["api_slim_chars"]}`,
  );
  assert.ok(
    m.all.now_mcp_bridge.chars <= (base["mcp_bridge_chars"] as number),
    `MCP view grew: ${m.all.now_mcp_bridge.chars} > ${base["mcp_bridge_chars"]}`,
  );
  assert.ok(
    m.default_toolset.now_api_slim.chars <= (base["default_api_slim_chars"] as number),
    "the default toolset grew",
  );
});

test("the tool layer's cuts are real: the key and the placeholder examples are gone from what is shown", () => {
  const m = measure();
  assert.ok(m.all.now_api_slim.chars < m.all.before_api_slim.chars);
  assert.ok(m.all.now_mcp_bridge.chars < m.all.before_mcp_bridge.chars);
});
