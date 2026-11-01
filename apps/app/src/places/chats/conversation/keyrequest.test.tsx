import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { keyWords, requestOf } from "./keyrequest-model.ts";
import { KeyRequestCard } from "./keyrequest.tsx";

test("the key reads as a name, never doubled", () => {
  assert.equal(keyWords("Fathom"), "Fathom key");
  assert.equal(keyWords("Dana_Lawmatics"), "Dana Lawmatics key");
  assert.equal(keyWords("Fathom_key"), "Fathom key");
});

test("a request is read from the answer, and a malformed one is not a request", () => {
  const r = requestOf({ request: { id: "vrq_1", name: "Fathom", fields: ["api_key"], reason: "To read meetings.", state: "waiting" } });
  assert.deepEqual(r?.fields, ["api_key"]);
  assert.equal(requestOf({}), null);
});

test("the card renders nothing before it has read the request, so no field flashes", () => {
  const html = renderToStaticMarkup(<KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_1" data={{ call: async () => ({}) } as never} />);
  assert.equal(html, "");
});
