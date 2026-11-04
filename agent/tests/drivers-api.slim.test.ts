// The tool list is re-sent with every call of a turn. Measured on the default tool set (64 tools of generated/mcp-tools.json): what the model is shown, before and after trimming what only a validator reads.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slimTool } from "../src/drivers/api/slim.ts";

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const tokens = (v: unknown): number => Math.round(JSON.stringify(v).length / 4);

test("the schemas shown to the model lose their patterns and examples and keep what it needs", () => {
  const all = (JSON.parse(read("generated/mcp-tools.json")) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }).tools;
  const names = new Set([...read("docs/frozen/agent-tools.md").matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]!));
  const tools = all.filter((t) => names.has(t.name)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  const slim = tools.map(slimTool);
  const before = tokens(tools), after = tokens(slim);
  console.log(`default tool list per call: ${before} tokens before, ${after} after (${Math.round((1 - after / before) * 100)}% less); a 20-call turn re-sends it ${20 * before} then ${20 * after}`);
  assert.ok(after < before * 0.9, `at least a tenth less (${before} to ${after})`);
  const text = JSON.stringify(slim);
  assert.ok(!text.includes('"examples"') && !text.includes('"pattern"'));
  // what the model needs stays: required, enum, types, descriptions
  const post = slim.find((t) => t.name === "chat_post")!.inputSchema as { required: string[]; properties: { mentions: { items: { properties: { kind: { enum: string[]; type: string } } } } } };
  assert.deepEqual(post.required, ["threadId", "body", "idempotencyKey"]);
  assert.deepEqual(post.properties.mentions.items.properties.kind, { enum: ["person", "agent"], type: "string" });
  // a property that is itself called pattern keeps its schema
  assert.deepEqual((slimTool({ name: "x", description: "", inputSchema: { type: "object", properties: { pattern: { type: "string", pattern: "^a$" } } } }).inputSchema as { properties: Record<string, unknown> }).properties, { pattern: { type: "string" } });
});
