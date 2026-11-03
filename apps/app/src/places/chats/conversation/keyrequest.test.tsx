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

test("approving an agent's key asks who can use it through the agent: only the person who asked is picked, anyone who asks the agent is the other choice (owner ruling, 3 Nov)", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, press, typeInto } = await import("../../../onboarding/test-dom.ts");
  const { AUDIENCES } = await import("./keyrequest-model.ts");
  assert.deepEqual(AUDIENCES.map((a) => a.label), ["Only the person who asked", "Anyone who asks this agent"]);
  const restore = installDom();
  try {
    const run = async (pick?: "anyone"): Promise<Record<string, unknown>> => {
      const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
      const call = async (cap: string, input: unknown): Promise<unknown> => {
        calls.push({ cap, input: input as Record<string, unknown> });
        if (cap === "vault.requests.get") return { request: { id: "vrq_1", name: "Fathom", fields: ["api_key"], reason: "To read meetings.", state: "waiting", folderId: "vfd_1" } };
        if (cap === "vault.requests.list") return { requests: [{ id: "vrq_1" }] };
        return {};
      };
      const root = await mount(createRoot, <KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_1" data={{ call } as never} />);
      const group = find(root, "keyreq-audience-vrq_1");
      assert.ok(group, "the question is on the card");
      assert.equal(find(root, "keyreq-audience-asker-vrq_1")?.props["aria-checked"], true, "only the person who asked, by default");
      assert.equal(find(root, "keyreq-audience-anyone-vrq_1")?.props["aria-checked"], false);
      if (pick) { await press(find(root, `keyreq-audience-${pick}-vrq_1`)); await flush(); assert.equal(find(root, "keyreq-audience-anyone-vrq_1")?.props["aria-checked"], true); }
      await typeInto(find(root, "keyreq-field-vrq_1-api_key"), "sk_test_fathom");
      await press(find(root, "keyreq-add-vrq_1"));
      await flush();
      return calls.find((c) => c.cap === "vault.requests.fulfil")!.input;
    };
    assert.equal((await run())["audience"], "asker");
    assert.equal((await run("anyone"))["audience"], "anyone");
  } finally { restore(); }
});
