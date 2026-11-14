import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeDecoder } from "../src/drivers/cli/claude.ts";

const line = (o: unknown): string => JSON.stringify(o);
const texts = (events: Array<{ type: string; text?: string }>): string =>
  events
    .filter((e) => e.type === "text")
    .map((e) => e.text)
    .join("");

test("two answers of one turn, when a helper's end comes between them with no tool step of the lead's own, are not run together", () => {
  const d = createClaudeDecoder();
  const out = [
    ...d.push(
      line({
        type: "assistant",
        message: { id: "m1", content: [{ type: "text", text: "Then the user and kernel." }] },
      }),
    ),
    // a helper finished: the engine reports it as a message of its own, then the lead writes again
    ...d.push(
      line({
        type: "user",
        message: { content: [{ type: "text", text: "<task-notification>done</task-notification>" }] },
      }),
    ),
    ...d.push(
      line({
        type: "assistant",
        message: { id: "m2", content: [{ type: "text", text: "The terminal subagent is done." }] },
      }),
    ),
  ];
  assert.equal(texts(out), "Then the user and kernel.\n\nThe terminal subagent is done.");
});

test("the same when the words are streamed: a new message of the engine starts a new paragraph", () => {
  const d = createClaudeDecoder();
  const delta = (t: string): string =>
    line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
  const start = (id: string): string =>
    line({ type: "stream_event", event: { type: "message_start", message: { id } } });
  const out = [...d.push(start("m1")), ...d.push(delta("One.")), ...d.push(start("m2")), ...d.push(delta("Two."))];
  assert.equal(texts(out), "One.\n\nTwo.");
});

test("words of one message stay as they are, and a first message has no leading break", () => {
  const d = createClaudeDecoder();
  const delta = (t: string): string =>
    line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
  const out = [
    ...d.push(line({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } })),
    ...d.push(delta("Hel")),
    ...d.push(delta("lo.")),
  ];
  assert.equal(texts(out), "Hello.");
});
