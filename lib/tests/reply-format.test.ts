// The formatting guide every agent turn carries: short (measured), and it names each thing the chat can draw and the tool for each interactive block.
import test from "node:test";
import assert from "node:assert/strict";
import { REPLY_FORMAT, REPLY_FORMAT_MAX_TOKENS, estimateTokens } from "../reply-format.ts";

test("the guide is short enough to ride in every turn's cached prefix", () => {
  const t = estimateTokens(REPLY_FORMAT);
  assert.ok(t <= REPLY_FORMAT_MAX_TOKENS, `${t} tokens, the cap is ${REPLY_FORMAT_MAX_TOKENS}`);
  console.log(`reply format guide: ${REPLY_FORMAT.length} characters, about ${t} tokens`);
});

test("it covers tables, diagrams, charts, math, code, callouts, collapsibles, checklists, footnotes, images and the interactive tools", () => {
  for (const w of ["table", "mermaid", "chart", "$$", "```", "[!NOTE]", "<details>", "- [ ]", "[^1]", "![alt]", "ask_question", "plan_propose", "vault_request", "artifact_publish"]) assert.ok(REPLY_FORMAT.includes(w), w);
  for (const kind of ["flowchart", "sequenceDiagram", "stateDiagram", "gantt", "erDiagram", "mindmap", "pie"]) assert.ok(REPLY_FORMAT.includes(kind), kind);
  for (const type of ["bar", "line", "area", "pie", "scatter"]) assert.ok(REPLY_FORMAT.includes(type), type);
});

test("it says when each form fits, so a model chooses by the information", () => {
  assert.match(REPLY_FORMAT, /Comparing things/);
  assert.match(REPLY_FORMAT, /process, flow or timeline/);
  assert.match(REPLY_FORMAT, /Numbers by time or category/);
  assert.match(REPLY_FORMAT, /never a table for one row/);
});

test("it gives one form for pointing at an item, and never an address or a bare id", () => {
  assert.ok(REPLY_FORMAT.includes("[[Name|id]]"));
  assert.match(REPLY_FORMAT, /Never type an address, a bare id or a ref\.vyre\.invalid link/);
});

test("it says which ids can be linked: Vyre items, and mail and calendar ids from tool results", () => {
  assert.match(REPLY_FORMAT, /email thread/);
  assert.match(REPLY_FORMAT, /calendar event/);
  assert.match(REPLY_FORMAT, /write the name alone/);
});

test("it tells agents about sections, marks and choices", () => {
  for (const w of ["[!section]", "++underline++", "==highlight==", "```choices"]) assert.ok(REPLY_FORMAT.includes(w), w);
});
