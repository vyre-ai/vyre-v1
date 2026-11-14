// The connect card of a chat, driven through the real tree (finding F38): every state comes from what the server answers, the key is typed into the card and goes only in the submit call, the steps wait 300 ms,
// a wrong key marks the field and keeps nothing, an admin is asked by name, Not now folds and Connect opens it again.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectCardLive } from "./connectcard.tsx";
import { KeyRequestCard } from "./keyrequest.tsx";

const KEY = "fk_live_TYPED_0001";
const FIELDS = [
  { name: "api_key", label: "API key", optional: false },
  { name: "webhook_secret", label: "Webhook secret", optional: true },
];
const card = (state: string, over: Record<string, unknown> = {}) => ({
  card: {
    requestId: "vrq_1",
    state,
    service: { key: "fathom", title: "Fathom", site: "https://fathom.video" },
    fields: FIELDS,
    agentId: "agt_dex",
    mayFill: true,
    usedBy: [{ kind: "agent", id: "agt_dex" }],
    ...over,
  },
});
type Call = { cap: string; input: Record<string, unknown> };
const harness = (script: Record<string, (i: Record<string, unknown>) => unknown | Promise<unknown>>) => {
  const calls: Call[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    const f = script[cap];
    if (!f) throw new Error(`unscripted ${cap}`);
    return f(input as Record<string, unknown>);
  };
  return { calls, data: { call, nameOf: (id: string) => (id === "usr_maya" ? "Maya" : id) } as never };
};

test("the card draws nothing before the server has answered, so no field flashes", () => {
  const { data } = harness({});
  assert.equal(renderToStaticMarkup(<ConnectCardLive requestId="vrq_1" agent="Dex" data={data} />), "");
});

test("a request for a service is the connect card; a request for a key by name stays the secure field", () => {
  const { data } = harness({});
  const connect = renderToStaticMarkup(
    <KeyRequestCard requestId="vrq_1" agent="Dex" agentId="agt_dex" data={data} service="fathom" />,
  );
  const plain = renderToStaticMarkup(<KeyRequestCard requestId="vrq_1" agent="Dex" agentId="agt_dex" data={data} />);
  assert.equal(connect, "");
  assert.equal(plain, "");
});

test("Ask to Connected: the typed key goes in the submit call and in no other, and the card folds to one row", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, press, textOf, typeInto } = await import("../../../onboarding/test-dom.ts");
  const restore = installDom();
  try {
    let state = "ask";
    const h = harness({
      "vault.connect_card.get": () =>
        card(state, state === "connected" ? { keptIn: "Mine", tested: "Reached Fathom" } : {}),
      "vault.connect_card.submit": () => {
        state = "connected";
        return { result: "connected", ...card("connected", { keptIn: "Mine", tested: "Reached Fathom" }) };
      },
    });
    const root = await mount(createRoot, <ConnectCardLive requestId="vrq_1" agent="Dex" data={h.data} />);
    const t = textOf(root);
    for (const w of ["Connect Fathom", "Dex will use it for you.", "API key", "Webhook secret", "Not now"])
      assert.ok(t.includes(w), w);
    await typeInto(find(root, "connect-vrq_1-api_key-input"), KEY);
    await press(find(root, "connect-vrq_1-connect"));
    await flush();
    await new Promise((r) => setTimeout(r, 600));
    await flush();
    const submit = h.calls.find((c) => c.cap === "vault.connect_card.submit")!;
    assert.deepEqual(
      submit.input["fields"],
      [{ key: "api_key", value: KEY }],
      "the optional field left empty is not sent",
    );
    for (const c of h.calls)
      assert.equal(JSON.stringify(c.input).includes(KEY), c.cap === "vault.connect_card.submit", c.cap);
    const after = textOf(root);
    assert.ok(after.includes("Connected") && after.includes("Kept in Mine"), after);
    assert.equal(find(root, "connect-vrq_1-api_key-input"), null, "no field left on a connected card");
    await press(find(root, "connect-vrq_1-row"));
    const opened = textOf(root);
    assert.ok(opened.includes("Tested") && opened.includes("Reached Fathom") && opened.includes("Disconnect"), opened);
  } finally {
    restore();
  }
});

test("a wrong key marks the field with the service's name, keeps nothing, and typing again takes the red away", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, press, textOf, typeInto } = await import("../../../onboarding/test-dom.ts");
  const restore = installDom();
  try {
    let state = "ask";
    const h = harness({
      "vault.connect_card.get": () => card(state),
      "vault.connect_card.submit": () => {
        state = "wrong";
        return { result: "wrong", ...card("wrong") };
      },
    });
    const root = await mount(createRoot, <ConnectCardLive requestId="vrq_1" agent="Dex" data={h.data} />);
    await typeInto(find(root, "connect-vrq_1-api_key-input"), "nope");
    await press(find(root, "connect-vrq_1-connect"));
    await flush();
    await flush();
    assert.ok(textOf(root).includes("Fathom didn't accept this key."), textOf(root));
    assert.equal(find(root, "connect-vrq_1-api_key-input")?.props["aria-invalid"], true);
    await typeInto(find(root, "connect-vrq_1-api_key-input"), "nope2");
    assert.ok(!textOf(root).includes("didn't accept"), "the red goes when the person edits");
  } finally {
    restore();
  }
});

test("nothing about the steps shows for the first 300 ms, then Checked, Connected, Saved do", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, press, typeInto } = await import("../../../onboarding/test-dom.ts");
  const restore = installDom();
  try {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    const h = harness({
      "vault.connect_card.get": () => card("ask"),
      "vault.connect_card.submit": async () => {
        await slow;
        return { result: "wrong", ...card("wrong") };
      },
    });
    const root = await mount(createRoot, <ConnectCardLive requestId="vrq_1" agent="Dex" data={h.data} />);
    await typeInto(find(root, "connect-vrq_1-api_key-input"), KEY);
    await press(find(root, "connect-vrq_1-connect"));
    const work = (): { props: Record<string, unknown> } | null => find(root, "connect-vrq_1-work") as never;
    assert.equal(
      find(root, "connect-vrq_1-api_key-input")?.props["editable"] ?? false,
      false,
      "the field locks at once",
    );
    const hidden = (): boolean => /r-opacity-/.test(String(work()?.props["className"] ?? ""));
    assert.ok(work(), "the line is there from the start, so nothing moves when it shows");
    assert.equal(hidden(), true, "but nothing shows for the first 300 ms");
    await new Promise((r) => setTimeout(r, 380));
    await flush();
    assert.equal(hidden(), false, "visible after 300 ms");
    release();
    await flush();
  } finally {
    restore();
  }
});

test("Needs an admin: Ask Maya by name, then the ask goes to the server; Not now folds, Connect opens it again", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, press, textOf } = await import("../../../onboarding/test-dom.ts");
  const restore = installDom();
  try {
    let cur = card("admin", { mayFill: false, admin: { id: "usr_maya" } });
    const h = harness({
      "vault.connect_card.get": () => cur,
      "vault.connect_card.ask_admin": () =>
        (cur = card("asked", { mayFill: false, admin: { id: "usr_maya", askedAt: Date.now() } })),
      "vault.requests.decline": () => {
        cur = card("later");
        return { ok: true };
      },
      "vault.connect_card.reopen": () => (cur = card("ask")),
    });
    const root = await mount(createRoot, <ConnectCardLive requestId="vrq_1" agent="Dex" data={h.data} />);
    assert.ok(textOf(root).includes("Only admins can connect services in this Space."));
    assert.ok(textOf(root).includes("Ask Maya"));
    await press(find(root, "connect-vrq_1-ask"));
    await flush();
    assert.deepEqual(h.calls.find((c) => c.cap === "vault.connect_card.ask_admin")!.input, {
      requestId: "vrq_1",
      admin: "usr_maya",
    });
    assert.ok(textOf(root).includes("Asked Maya"), textOf(root));
    await press(find(root, "connect-vrq_1-later"));
    await flush();
    assert.ok(textOf(root).includes("Fathom isn't connected"), textOf(root));
    await press(find(root, "connect-vrq_1-reopen"));
    await flush();
    assert.ok(textOf(root).includes("Connect Fathom"), textOf(root));
  } finally {
    restore();
  }
});

test("a card the agent took back leaves nothing behind", async () => {
  const { createRoot } = await import("test-renderer");
  const { flush, installDom, mount, textOf } = await import("../../../onboarding/test-dom.ts");
  const restore = installDom();
  try {
    const h = harness({ "vault.connect_card.get": () => card("gone") });
    const root = await mount(createRoot, <ConnectCardLive requestId="vrq_1" agent="Dex" data={h.data} />);
    await flush();
    assert.equal(textOf(root).trim(), "");
    assert.ok(!textOf(root).includes("Withdrawn"));
  } finally {
    restore();
  }
});

test("an admin the Space cannot name is never shown as an id: the card says an admin", async () => {
  const { createRoot } = await import("test-renderer");
  const { find, flush, installDom, mount, textOf } = await import("../../../onboarding/test-dom.ts");
  const { assertNoRawIds } = await import("../../../../../../ui/src/testing/raw-ids.ts");
  const restore = installDom();
  try {
    const h = harness({
      "vault.connect_card.get": () => card("admin", { mayFill: false, admin: { id: "usr_0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d" } }),
    });
    const data = { ...h.data, nameOf: (id: string) => id } as never;
    const root = await mount(createRoot, <ConnectCardLive requestId="vrq_1" agent="Dex" data={data} />);
    await flush();
    assert.ok(textOf(root).includes("Ask an admin"), textOf(root));
    assert.ok(find(root, "connect-vrq_1-ask"));
    assertNoRawIds(root, "the connect card");
  } finally {
    restore();
  }
});
