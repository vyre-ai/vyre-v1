// The mic in the real composer: words land in the field at the cursor, Esc takes back only what Talk added, typed text is never lost, it never sends, and the mic's slot is the same in every state. A fake mic and a fake Deepgram socket stand in.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { flush, find, installDom, mount, press, typeInto } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { Composer, TalkContext } from "./index.tsx";
import type { TalkPort } from "./index.tsx";
import { placed } from "./Talk.tsx";
import type { TalkSession, TalkSocket } from "./talk.ts";

const SESSION: TalkSession = { provider: "deepgram", url: "wss://api.deepgram.com/v1/listen", protocols: ["bearer", "jwt"], source: "space", expiresIn: 30 };
const words = (text: string, final = false): string => JSON.stringify({ type: "Results", is_final: final, channel: { alternatives: [{ transcript: text }] } });

function rig(over: Partial<TalkPort> = {}) {
  const sockets: TalkSocket[] = [];
  const state = { setups: 0, micStopped: 0 };
  const port: TalkPort = {
    on: true, session: async () => SESSION, setup: async () => { state.setups++; return false; }, noteOff: () => undefined,
    deps: {
      openMic: async () => ({ stop: () => { state.micStopped++; } }),
      openSocket: () => { const s: TalkSocket = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null, send() {}, close() {} }; sockets.push(s); return s; },
      later: () => 0,
    },
    ...over,
  };
  return { port, sockets, state };
}
const field = (root: Node): Node | null => find(root, "composer-field");
const pressIn = async (n: Node | null): Promise<void> => { await act(async () => { (n!.props.onPointerDown as (e: unknown) => void)({ pointerId: 1, currentTarget: {} }); }); };
const pressOut = async (n: Node | null): Promise<void> => { await act(async () => { (n!.props.onPointerUp as () => void)(); }); };
const open = async (s: TalkSocket): Promise<void> => { await act(async () => { s.readyState = 1; s.onopen?.({}); }); };
const hear = async (s: TalkSocket, text: string, final = false): Promise<void> => { await act(async () => { s.onmessage?.({ data: words(text, final) }); }); };
const esc = async (): Promise<void> => { await act(async () => { (globalThis as unknown as { dispatchKey?: (k: string) => void }).dispatchKey?.("Escape"); }); };
async function withDom(run: () => Promise<void>): Promise<void> {
  const restore = installDom();
  const listeners: ((e: { key: string; preventDefault(): void; stopPropagation(): void }) => void)[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const before = [g["addEventListener"], g["removeEventListener"]];
  g["addEventListener"] = (t: string, f: never) => { if (t === "keydown") listeners.push(f); };
  g["removeEventListener"] = (t: string, f: never) => { const i = listeners.indexOf(f); if (t === "keydown" && i >= 0) listeners.splice(i, 1); };
  g["dispatchKey"] = (key: string) => { for (const f of [...listeners]) f({ key, preventDefault() {}, stopPropagation() {} }); };
  try { await run(); } finally { g["addEventListener"] = before[0]; g["removeEventListener"] = before[1]; delete g["dispatchKey"]; restore(); }
}
const tree = (port: TalkPort, el: ReactElement): ReactElement => <TalkContext.Provider value={port}>{el}</TalkContext.Provider>;

test("no port, no mic: a native app or a place with no shell draws none; off draws none", () => {
  assert.doesNotMatch(renderToStaticMarkup(<Composer whoWillAnswer="" />), /composer-talk/);
  assert.match(renderToStaticMarkup(tree(rig().port, <Composer whoWillAnswer="" />)), /composer-talk/);
  assert.doesNotMatch(renderToStaticMarkup(tree(rig({ on: false }).port, <Composer whoWillAnswer="" />)), /composer-talk/);
});

test("the mic is there beside a draft and while an agent works, so words can join what is typed", () => {
  const html = renderToStaticMarkup(tree(rig().port, <Composer whoWillAnswer="" value="draft" working />));
  assert.match(html, /composer-talk/);
  assert.match(html, /composer-split/);
});

test("a tap listens, live words land in the field, and a second tap keeps them; nothing is sent", async () => {
  await withDom(async () => {
    const t = rig();
    let sent = 0;
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" onSubmit={() => { sent++; }} />));
    const mic = find(root, "composer-talk");
    await pressIn(mic); await pressOut(mic);
    await flush();
    assert.ok(find(root, "composer-talk-level"), "the level shows as soon as it starts");
    await open(t.sockets[0]!);
    await hear(t.sockets[0]!, "also check");
    assert.equal(field(root)!.props.value, "also check");
    await hear(t.sockets[0]!, "Also check how it looks.", true);
    await hear(t.sockets[0]!, "on a");
    assert.equal(field(root)!.props.value, "Also check how it looks. on a");
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    assert.equal(t.state.micStopped, 1);
    await hear(t.sockets[0]!, "on a phone.", true);
    await act(async () => { t.sockets[0]!.onclose?.({}); });
    assert.equal(field(root)!.props.value, "Also check how it looks. on a phone.");
    assert.equal(find(root, "composer-talk-level"), null);
    assert.equal(sent, 0, "it never sends");
  });
});

test("the keyboard toggles it: a click with no pointer starts and stops", async () => {
  await withDom(async () => {
    const t = rig();
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" />));
    await press(find(root, "composer-talk"));
    await flush();
    await open(t.sockets[0]!);
    await press(find(root, "composer-talk"));
    assert.equal(t.state.micStopped, 1);
  });
});

test("holding it talks until you let go", async () => {
  await withDom(async () => {
    const t = rig();
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" />));
    await pressIn(find(root, "composer-talk"));
    await flush();
    await open(t.sockets[0]!);
    await new Promise((r) => setTimeout(r, 300));
    await pressOut(find(root, "composer-talk"));
    assert.equal(t.state.micStopped, 1, "letting go stops the mic");
  });
});

test("Esc takes back only what Talk added: the typed text stays, and it goes on listening no longer", async () => {
  await withDom(async () => {
    const t = rig();
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" value="typed first" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    await open(t.sockets[0]!);
    await hear(t.sockets[0]!, "and these words");
    assert.equal(field(root)!.props.value, "typed first and these words");
    await esc();
    await flush();
    assert.equal(field(root)!.props.value, "typed first");
    assert.equal(find(root, "composer-talk-level"), null);
    assert.equal(t.state.micStopped, 1);
  });
});

test("typing while it listens keeps what you typed, and later words carry on after it", async () => {
  await withDom(async () => {
    const t = rig();
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    await open(t.sockets[0]!);
    await hear(t.sockets[0]!, "first part", true);
    await typeInto(field(root), "first part typed");
    await hear(t.sockets[0]!, "second part", true);
    assert.equal(field(root)!.props.value, "first part typed second part");
  });
});

test("a press with no key opens the sheet; once a key is saved it listens at once, the ta-da", async () => {
  await withDom(async () => {
    let first = true;
    const t = rig({
      session: async () => { if (first) { first = false; throw Object.assign(new Error("Talk needs a key."), { details: { reason: "no_key" } }); } return SESSION; },
      setup: async () => true,
    });
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    assert.equal(t.sockets.length, 1, "the socket opened with no second press");
    assert.ok(find(root, "composer-talk-level"));
  });
});

test("a refused mic, a revoked key and a dropped socket each say one line, and what is in the field stays", async () => {
  await withDom(async () => {
    const t = rig();
    t.port.deps!.openMic = async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); };
    t.port.deps!.shell = "web";
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" value="keep me" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    assert.match(String((find(root, "composer-talk-line") as Node).children?.[0]), /Your browser blocked the microphone/);
    assert.equal(field(root)!.props.value, "keep me");
  });
  await withDom(async () => {
    const t = rig({ session: async () => { throw Object.assign(new Error("Deepgram no longer accepts your key. Add a new one in Settings, AI, Voice."), { code: "provider.auth_failed", details: { reason: "revoked" } }); } });
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" value="keep me" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    assert.match(String((find(root, "composer-talk-line") as Node).children?.[0]), /no longer accepts your key/);
    assert.equal(field(root)!.props.value, "keep me");
  });
  await withDom(async () => {
    const t = rig();
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" value="keep me" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    await open(t.sockets[0]!);
    await hear(t.sockets[0]!, "and this", true);
    await act(async () => { t.sockets[0]!.onclose?.({}); });
    assert.match(String((find(root, "composer-talk-line") as Node).children?.[0]), /lost its connection/);
    assert.equal(field(root)!.props.value, "keep me and this");
  });
});

test("words go in at the cursor and are spaced from what is around them", () => {
  assert.deepEqual(placed({ before: "Hello ", after: "" }, "there"), { text: "Hello there", cursor: 11 });
  assert.deepEqual(placed({ before: "Hello", after: "world" }, "big"), { text: "Hello big world", cursor: 9 });
  assert.deepEqual(placed({ before: "", after: "" }, ""), { text: "", cursor: 0 });
  assert.deepEqual(placed({ before: "a", after: "b" }, ""), { text: "ab", cursor: 1 });
});

const noKey = (): never => { throw Object.assign(new Error("Talk needs a key."), { details: { reason: "no_key" } }); };

test("nothing covers the person in a team Space: the press says Voice isn't set up, asks for no key, and opens no socket", async () => {
  await withDom(async () => {
    const t = rig({ session: async () => noKey(), unset: { admin: false, open: () => undefined } });
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" value="keep me" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    assert.equal(String((find(root, "composer-talk-line") as Node).children?.[0]), "Voice isn't set up. Ask an admin to add a key.");
    assert.equal(find(root, "composer-talk-link"), null, "a member has nowhere to add one");
    assert.equal(t.state.setups, 0, "the first-press key sheet is not opened");
    assert.equal(t.sockets.length, 0);
    assert.equal(field(root)!.props.value, "keep me");
  });
});

test("an admin gets the same line and a link to where the Space key is added", async () => {
  await withDom(async () => {
    let opened = 0;
    const t = rig({ session: async () => noKey(), unset: { admin: true, open: () => { opened++; } } });
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    assert.match(String((find(root, "composer-talk-line") as Node).children?.[0]), /Voice isn't set up/);
    const link = find(root, "composer-talk-link");
    assert.ok(link, "the link is there for an admin");
    await press(link);
    assert.equal(opened, 1, "pressing it opens where the Space key is added");
  });
});

test("with a key covering them nothing changes: a Personal Space or a covered person still gets the first-press sheet when a key is missing", async () => {
  await withDom(async () => {
    const t = rig({ session: async () => noKey() });
    const root = await mount(createRoot, tree(t.port, <Composer whoWillAnswer="" />));
    await pressIn(find(root, "composer-talk")); await pressOut(find(root, "composer-talk"));
    await flush();
    assert.equal(t.state.setups, 1, "no unset: the sheet, as before");
  });
});
