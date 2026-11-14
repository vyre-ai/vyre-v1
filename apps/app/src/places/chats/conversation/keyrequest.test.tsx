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
  const r = requestOf({
    request: { id: "vrq_1", name: "Fathom", fields: ["api_key"], reason: "To read meetings.", state: "waiting" },
  });
  assert.deepEqual(r?.fields, ["api_key"]);
  assert.equal(requestOf({}), null);
});

test("the card renders nothing before it has read the request, so no field flashes", () => {
  const html = renderToStaticMarkup(
    <KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_1" data={{ call: async () => ({}) } as never} />,
  );
  assert.equal(html, "");
});

test("approving an agent's key asks who can use it through the agent: only the person who asked is picked, anyone who asks the agent is the other choice (owner ruling, 3 Nov)", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, press, typeInto } = await import("../../../onboarding/test-dom.ts");
  const { AUDIENCES } = await import("./keyrequest-model.ts");
  assert.deepEqual(
    AUDIENCES.map((a) => a.label),
    ["Only the person who asked", "Anyone who asks this agent"],
  );
  const restore = installDom();
  try {
    const run = async (pick?: "anyone"): Promise<Record<string, unknown>> => {
      const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
      const call = async (cap: string, input: unknown): Promise<unknown> => {
        calls.push({ cap, input: input as Record<string, unknown> });
        if (cap === "vault.requests.get")
          return {
            request: {
              id: "vrq_1",
              name: "Fathom",
              fields: ["api_key"],
              reason: "To read meetings.",
              state: "waiting",
              folderId: "vfd_1",
            },
          };
        if (cap === "vault.requests.list") return { requests: [{ id: "vrq_1" }] };
        return {};
      };
      const root = await mount(
        createRoot,
        <KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_1" data={{ call } as never} />,
      );
      const group = find(root, "keyreq-audience-vrq_1");
      assert.ok(group, "the question is on the card");
      assert.equal(
        find(root, "keyreq-audience-asker-vrq_1")?.props["aria-checked"],
        true,
        "only the person who asked, by default",
      );
      assert.equal(find(root, "keyreq-audience-anyone-vrq_1")?.props["aria-checked"], false);
      if (pick) {
        await press(find(root, `keyreq-audience-${pick}-vrq_1`));
        await flush();
        assert.equal(find(root, "keyreq-audience-anyone-vrq_1")?.props["aria-checked"], true);
      }
      await typeInto(find(root, "keyreq-field-vrq_1-api_key"), "sk_test_fathom");
      await press(find(root, "keyreq-add-vrq_1"));
      await flush();
      return calls.find((c) => c.cap === "vault.requests.fulfil")!.input;
    };
    assert.equal((await run())["audience"], "asker");
    assert.equal((await run("anyone"))["audience"], "anyone");
  } finally {
    restore();
  }
});

test("15 Nov: the team choice is offered only when the agent can use a shared folder, and the key goes into one it can use, never the first by name", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, press, typeInto } = await import("../../../onboarding/test-dom.ts");
  const restore = installDom();
  try {
    const run = async (usable: string[], pick?: "anyone") => {
      const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
      const call = async (cap: string, input: unknown): Promise<unknown> => {
        const i = input as Record<string, unknown>;
        calls.push({ cap, input: i });
        if (cap === "vault.requests.get")
          return {
            request: {
              id: "vrq_1",
              name: "Fathom",
              fields: ["api_key"],
              reason: "r",
              state: "waiting",
              askedYou: true,
            },
          };
        if (cap === "vault.requests.list") return { requests: [{ id: "vrq_1" }] };
        if (cap === "vault.folders.list")
          return { folders: i["scope"] === "mine" ? [{ id: "vfd_mine" }] : [{ id: "vfd_hidden" }, { id: "vfd_team" }] };
        if (cap === "access.clears") return { clears: usable.includes((i["target"] as { id: string }).id) };
        return {};
      };
      const root = await mount(
        createRoot,
        <KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_1" data={{ call } as never} />,
      );
      await flush();
      const offered = !!find(root, "keyreq-audience-anyone-vrq_1");
      if (pick && offered) {
        await press(find(root, "keyreq-audience-anyone-vrq_1"));
        await flush();
      }
      await typeInto(find(root, "keyreq-field-vrq_1-api_key"), "sk_test_fathom");
      await press(find(root, "keyreq-add-vrq_1"));
      await flush();
      return { offered, fulfil: calls.find((c) => c.cap === "vault.requests.fulfil")!.input };
    };
    const none = await run([], "anyone");
    assert.equal(none.offered, false, "no shared folder the agent can use: the team choice is not there");
    assert.equal(none.fulfil["audience"], "asker");
    assert.equal(none.fulfil["folderId"], "vfd_mine");
    const some = await run(["vfd_team"], "anyone");
    assert.equal(some.offered, true);
    assert.equal(some.fulfil["audience"], "anyone");
    assert.equal(some.fulfil["folderId"], "vfd_team", "the first folder the agent can use, not the first folder");
  } finally {
    restore();
  }
});

test("15 Nov: a manager answering someone else's ask, with no shared folder the agent can use, is told so and cannot add; their own keys are never offered", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount } = await import("../../../onboarding/test-dom.ts");
  const restore = installDom();
  try {
    const calls: string[] = [];
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      calls.push(cap);
      const i = input as Record<string, unknown>;
      if (cap === "vault.requests.get")
        return { request: { id: "vrq_1", name: "Fathom", fields: ["api_key"], reason: "r", state: "waiting" } };
      if (cap === "vault.requests.list") return { requests: [{ id: "vrq_1" }] };
      if (cap === "vault.folders.list")
        return { folders: i["scope"] === "mine" ? [{ id: "vfd_mine" }] : [{ id: "vfd_hidden" }] };
      if (cap === "access.clears") return { clears: false };
      return {};
    };
    const root = await mount(
      createRoot,
      <KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_1" data={{ call } as never} />,
    );
    await flush();
    assert.ok(find(root, "keyreq-nowhere-vrq_1"), "says there is nowhere to put it");
    assert.equal(find(root, "keyreq-audience-anyone-vrq_1"), null);
    assert.ok(!calls.includes("vault.requests.fulfil"));
  } finally {
    restore();
  }
});
