// The capability map: every tool it names exists, every area of the catalog has a line, it stays about a page, and it rides in the stable rules section of every turn.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPABILITY_MAP } from "../capability-map.ts";
import { estimateTokens } from "../../../lib/reply-format.ts";

const tools = (JSON.parse(readFileSync(new URL("../../../generated/mcp-tools.json", import.meta.url), "utf8")) as { tools: { name: string; toolset: string }[] }).tools;
const names = new Set(tools.map((t) => t.name));

test("every tool the map names is a real tool", () => {
  const named = [...new Set(CAPABILITY_MAP.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])];
  assert.ok(named.length > 100, `${named.length} names`);
  assert.deepEqual(named.filter((n) => !names.has(n)), []);
});

test("it is about a page: 1.0k to 1.6k tokens", () => {
  const t = estimateTokens(CAPABILITY_MAP);
  assert.ok(t >= 1000 && t <= 1600, `${t} tokens`);
  console.log(`capability map: ${CAPABILITY_MAP.length} characters, about ${t} tokens`);
});

test("every area an agent works in has tools named, and each line names the tools a task starts with", () => {
  const named = new Set(CAPABILITY_MAP.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
  for (const set of ["inbox", "files", "records", "memory", "tasks", "vault", "chats", "agents", "automations", "computer", "terminal", "sites"]) {
    assert.ok(tools.some((t) => t.toolset === set && named.has(t.name)), `no tool of ${set}`);
  }
  for (const line of CAPABILITY_MAP.split("\n").slice(1)) assert.match(line, /^- [A-Z][^:]*: .*_.*\.$/, line);
});

test("it is in the stable rules section of a turn's context", async () => {
  const src = readFileSync(new URL("../context.ts", import.meta.url), "utf8");
  assert.match(src, /add\("rules", true, .*CAPABILITY_MAP\)/);
});

test("the stable rules ask for independent tool calls to be made together", () => {
  const src = readFileSync(new URL("../context.ts", import.meta.url), "utf8");
  assert.match(src, /When steps do not depend on each other, call their tools together in one step/);
});
