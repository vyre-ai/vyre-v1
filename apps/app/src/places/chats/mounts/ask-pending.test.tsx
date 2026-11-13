// An Ask or a chat that opens with the person's own first message (Home's Ask, a task, a project, an agent) shows that message and the working mark while its thread is found or made: nothing waits on the server to show his words.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createMountSample } from "./sample.ts";
import { ChatsMounted } from "./ChatsMounted.tsx";
import type { Shown } from "./route.ts";

const shown = (first?: string): Shown => ({ route: { view: "ask", agentId: "assistant", scopeType: "", scopeId: "", bringFrom: null, ...(first ? { first } : {}) }, pane: false, terminalId: null, layer: null });
const draw = (s: Shown): string => renderToStaticMarkup(<ChatsMounted rt={createMountSample().rt} initial={s} window={{ start: 0, end: 500 }} />);

test("an Ask with a first message draws that message and the working mark before any thread exists", () => {
  const html = draw(shown("Summarise the open tasks for the Lisbon team"));
  assert.match(html, /data-testid="msg-pending"/);
  assert.match(html, /Summarise the open tasks for the Lisbon team/);
  assert.match(html, /data-testid="working-mark"/);
});

test("an Ask with no message of his has none to draw: it keeps the loading frame", () => {
  const html = draw(shown());
  assert.doesNotMatch(html, /data-testid="msg-pending"/);
  assert.match(html, /data-testid="conversation-loading"/);
});
