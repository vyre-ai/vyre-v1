// The chat's "After this" line is on the screen: while someone else's turn runs, a message of yours waits and the line under the thread says so (it was only in the model, never drawn).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { Conversation } from "./Conversation.tsx";
import { waiting } from "../../../../../../scripts/shots/mounts/AFTERTHIS_01.tsx";

test("the queue line draws on the page: After this for someone else's turn, Goes in at the next step for your own", async () => {
  for (const own of [false, true]) {
    const out = renderToStaticMarkup(<Conversation data={waiting(own)} />);
    // the waiting list is asked of the engine after mount, so the first frame holds the message ids: the line is there from the start
    assert.ok(out.includes('data-testid="queue-note"'), "the line is drawn");
    assert.ok(out.includes(own ? "Goes in at the next step" : "After this: it goes in when this turn ends"), own ? "your own turn" : "someone else's turn");
  }
});
