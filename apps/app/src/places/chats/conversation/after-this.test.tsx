// The chat's "After this" line is on the screen: while someone else's turn runs, a message of yours waits and the line under the thread says so (it was only in the model, never drawn).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { Conversation } from "./Conversation.tsx";
import { waiting } from "./waiting-sample.ts";

test("the queue line draws on the page: After this for someone else's turn, At the next step for your own", async () => {
  for (const own of [false, true]) {
    const out = renderToStaticMarkup(<Conversation data={waiting(own)} />);
    // the waiting list is asked of the engine after mount, so the first frame holds the message ids: the line is there from the start
    assert.ok(out.includes('data-testid="queue-note"'), "the line is drawn");
    assert.ok(
      out.includes(own ? "At the next step" : "After this: it goes in when this turn ends"),
      own ? "your own turn" : "someone else's turn",
    );
    // under the message it waits for (G11), after its words, not a centred line above the composer
    const at = out.indexOf('data-testid="queue-row"');
    assert.ok(at > out.indexOf('data-testid="body-'), "the note comes after the message's own words");
    assert.ok(
      out.indexOf('data-testid="composer') < 0 || out.indexOf('data-testid="composer') > at,
      "and before the composer",
    );
  }
});

test("three queued messages: each has its own note, and Edit and Stop and send act on the message they sit under (review, 14 Nov)", async () => {
  const { installDom, mount, press, flush } = await import("../../../../../../ui/src/testing/dom.ts");
  const { createRoot } = await import("test-renderer");
  type N = { props: Record<string, unknown>; children?: (N | string)[] };
  const all = (n: N, id: string, out: N[] = []): N[] => {
    if (n.props?.["data-testid"] === id || n.props?.testID === id) out.push(n);
    for (const c of n.children ?? []) if (typeof c === "object") all(c, id, out);
    return out;
  };
  const restore = installDom();
  try {
    const data = waiting(true, 3);
    const calls: { cap: string; input: Record<string, unknown> }[] = [];
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      calls.push({ cap, input: input as Record<string, unknown> });
      return data.call(cap, input);
    };
    const root = (await mount(createRoot, <Conversation data={{ ...data, call }} />)) as unknown as N;
    const sends = all(root, "queue-send-now");
    assert.equal(sends.length, 3, "one note per queued message");
    await press(sends[1] as never);
    await flush();
    assert.deepEqual(
      calls.filter((c) => c.cap === "engine.interrupt").map((c) => c.input["messageId"]),
      ["q2"],
      "the second note stops and sends the second message, not the first",
    );
    await press(all(root, "queue-edit")[2] as never);
    await flush();
    assert.deepEqual(
      calls.filter((c) => c.cap === "engine.drop_queued").map((c) => c.input["messageId"]),
      ["q3"],
      "the third note takes back the third message",
    );
  } finally {
    restore();
  }
});
