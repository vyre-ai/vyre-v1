import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessRequestCard, accessLine } from "./accessrequest.tsx";

test("the ask reads as who wants what", () => {
  assert.equal(accessLine("Maya", { requestId: "arq_1", level: "use", resourceTitle: "Fathom" }), "Maya asks for use access to Fathom");
});
test("the card renders nothing before it has read the request", () => {
  assert.equal(renderToStaticMarkup(<AccessRequestCard block={{ requestId: "arq_1" }} data={{ call: async () => ({}), nameOf: (x: string) => x } as never} />), "");
});
