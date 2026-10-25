// The shots mount of P-L9_20 renders (the screens the side-by-side pictures and the stream probe take): the held conversation on the server, with the question, the day line and the reserved
// header of the answer before any delta has arrived.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Mount, { title } from "../../scripts/shots/mounts/P-L9_20.tsx";

test("the conversation mount renders its question and the answer's header before the stream starts", () => {
  const html = renderToStaticMarkup(<Mount />);
  assert.equal(title, "Streaming chat");
  assert.match(html, /Can you merge the three intake forms into one\?/);
  assert.match(html, /Today/);
  assert.match(html, /Intake/);
  assert.match(html, /data-testid="stream-list"/);
});
