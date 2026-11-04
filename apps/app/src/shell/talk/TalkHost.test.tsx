// The first-press sheet adapts to who presses: an admin chooses for everyone or just them, a member gets their own key with a quiet note, a Personal Space has one choice. A bad key stays out of the Vault, one line says why, and the typed key goes to one call only.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { TalkSheet, keyFields, offersSpace } from "./TalkHost.tsx";
import type { TalkStatus } from "./TalkHost.tsx";
import type { ShellRuntime } from "../providers/runtime.tsx";

const KEY = "dg_test_key_not_a_real_key"; // secret-scan: fake
const status = (o: Partial<TalkStatus> = {}): TalkStatus => ({
  on: true, provider: "deepgram", language: "multi", model: "nova-3", source: "none", spaceOn: false, mayManage: false,
  providers: [{ key: "deepgram", name: "Deepgram", keyUrl: "https://console.deepgram.com/", models: [{ id: "nova-3", label: "Nova 3" }], languages: [{ id: "multi", label: "Automatic" }] }], ...o,
});
function rt(kind: "team" | "personal", answer: (cap: string, i: unknown) => unknown = () => ({})) {
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  return { calls, opened, rt: { space: { kind }, call: async (cap: string, input: unknown) => { calls.push({ cap, input }); return answer(cap, input); }, openUrl: (u: string) => { opened.push(u); } } as unknown as ShellRuntime };
}
const withDom = async (run: () => Promise<void>): Promise<void> => { const restore = installDom(); try { await run(); } finally { restore(); } };

test("who sees the choice: someone who may run a team Space", () => {
  assert.equal(offersSpace(status({ mayManage: true }), false), true);
  assert.equal(offersSpace(status({ mayManage: false }), false), false);
  assert.equal(offersSpace(status({ mayManage: true }), true), false, "a Personal Space has nobody else");
  assert.equal(offersSpace(null, false), false);
});

test("an admin sees For everyone first, and the key goes to the Space's one door", async () => {
  await withDom(async () => {
    const w = rt("team");
    let done = 0;
    const root = await mount(createRoot, <TalkSheet rt={w.rt} status={status({ mayManage: true })} onDone={() => { done++; }} onCancel={() => undefined} />);
    assert.equal(find(root, "talk-scope-space")!.props["aria-checked"], true);
    assert.ok(find(root, "talk-scope-mine"));
    assert.equal(find(root, "talk-admin-note"), null);
    await typeInto(find(root, "talk-key"), KEY);
    await press(find(root, "talk-turn-on"));
    await flush();
    assert.equal(done, 1);
    assert.equal(w.calls.length, 1, "the key goes to one call only");
    assert.equal(w.calls[0]!.cap, "talk.space.connect");
    assert.deepEqual((w.calls[0]!.input as { fields: unknown }).fields, keyFields(KEY));
    assert.ok((w.calls[0]!.input as { idempotencyKey?: string }).idempotencyKey);
  });
});

test("an admin who picks Just me uses their own door", async () => {
  await withDom(async () => {
    const w = rt("team");
    const root = await mount(createRoot, <TalkSheet rt={w.rt} status={status({ mayManage: true })} onDone={() => undefined} onCancel={() => undefined} />);
    await press(find(root, "talk-scope-mine"));
    await typeInto(find(root, "talk-key"), KEY);
    await press(find(root, "talk-turn-on"));
    await flush();
    assert.equal(w.calls[0]!.cap, "talk.connect");
  });
});

test("a member sees only their own key and a quiet note; a Personal Space shows neither the choice nor the note", async () => {
  await withDom(async () => {
    const member = await mount(createRoot, <TalkSheet rt={rt("team").rt} status={status()} onDone={() => undefined} onCancel={() => undefined} />);
    assert.equal(find(member, "talk-scope-space"), null);
    assert.match(textOf(find(member, "talk-admin-note")), /An admin can turn this on for everyone/);
    const personal = await mount(createRoot, <TalkSheet rt={rt("personal").rt} status={status({ mayManage: true })} onDone={() => undefined} onCancel={() => undefined} />);
    assert.equal(find(personal, "talk-scope-space"), null);
    assert.equal(find(personal, "talk-admin-note"), null);
  });
});

test("a bad key says one line and stays in the sheet; Not now calls nothing; a locked Vault says what to do; the link opens the provider", async () => {
  await withDom(async () => {
    const w = rt("team", () => { throw new Error("Deepgram did not accept that key. Check it and try again."); });
    let cancelled = 0, done = 0;
    const root = await mount(createRoot, <TalkSheet rt={w.rt} status={status()} onDone={() => { done++; }} onCancel={() => { cancelled++; }} />);
    assert.equal(w.calls.length, 0);
    await press(find(root, "talk-turn-on")).catch(() => undefined);
    await flush();
    assert.equal(w.calls.length, 0, "nothing to send yet");
    await typeInto(find(root, "talk-key"), "bad");
    await press(find(root, "talk-turn-on"));
    await flush();
    assert.equal(done, 0);
    assert.match(textOf(find(root, "talk-error")), /did not accept that key/);
    await press(find(root, "talk-get-key"));
    assert.deepEqual(w.opened, ["https://console.deepgram.com/"]);
    await press(find(root, "talk-cancel"));
    assert.equal(cancelled, 1);
    const locked = rt("team", () => { throw Object.assign(new Error("Your vault key is locked."), { details: { reason: "vault_locked" } }); });
    const r2 = await mount(createRoot, <TalkSheet rt={locked.rt} status={status()} onDone={() => undefined} onCancel={() => undefined} />);
    await typeInto(find(r2, "talk-key"), "k");
    await press(find(r2, "talk-turn-on"));
    await flush();
    assert.match(textOf(find(r2, "talk-error")), /An admin can turn on Talk for everyone/);
  });
});
