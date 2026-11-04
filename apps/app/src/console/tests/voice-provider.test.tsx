// Console > AI > Voice: the Provider for everyone row says which provider is in use and which has no key yet; a provider with a key is switched to with talk.space.configure, one without opens its key form.
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { VoiceSettings } from "../pages/Voice.tsx";
import { dataWith } from "./sheet-helper.tsx";

const PROVIDERS = [
  { key: "deepgram", name: "Deepgram", keyUrl: "https://console.deepgram.com/", models: [], languages: [] },
  { key: "elevenlabs", name: "ElevenLabs", keyUrl: "https://elevenlabs.io/", models: [], languages: [] },
];
const ME = { on: true, provider: "deepgram", language: "multi", model: "nova-3", source: "space", spaceOn: true, mayManage: true, providers: PROVIDERS };

async function page(keyed: string[]) {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const space = { set: true, on: true, provider: "deepgram", setBy: "usr_a", checkedAt: Date.now(), state: "ok", peopleOwnKey: 0, keyed };
  const call = async (cap: string, input: unknown): Promise<unknown> => { calls.push({ cap, input: input as Record<string, unknown> }); return space; };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({ "talk.space.status": space, "talk.status": ME }, { call } as never)}><VoiceSettings /></ConsoleDataProvider>);
  return { root, calls, restore };
}
const configure = (calls: Array<{ cap: string; input: Record<string, unknown> }>) => calls.filter((c) => c.cap === "talk.space.configure").map((c) => c.input);

test("the row names the provider in use and the one with no key yet", async () => {
  const { root, restore } = await page(["deepgram"]);
  try {
    const row = textOf(find(root, "row-voice-provider"));
    assert.match(row, /Deepgram \(in use\)/);
    assert.match(row, /ElevenLabs \(no key yet\)/);
    assert.ok(find(root, "voice-use-elevenlabs"));
    assert.equal(find(root, "voice-use-deepgram"), null, "the one in use has no button");
  } finally { restore(); }
});

test("a provider with no key opens its key form instead of switching", async () => {
  const { root, calls, restore } = await page(["deepgram"]);
  try {
    assert.match(textOf(find(root, "voice-use-elevenlabs")), /Add ElevenLabs key/);
    await press(find(root, "voice-use-elevenlabs"));
    assert.ok(find(root, "voice-key"), "the key form is open");
    assert.match(textOf(root), /ElevenLabs key/);
    assert.deepEqual(configure(calls), []);
  } finally { restore(); }
});

test("a provider the Space has a key for is switched to with talk.space.configure", async () => {
  const { root, calls, restore } = await page(["deepgram", "elevenlabs"]);
  try {
    assert.match(textOf(find(root, "voice-use-elevenlabs")), /Use ElevenLabs/);
    await press(find(root, "voice-use-elevenlabs"));
    assert.deepEqual(configure(calls), [{ provider: "elevenlabs" }]);
  } finally { restore(); }
});
