// Console > AI > Voice: the intro, the headline for each state of the Space key, and every control pressed by its testID with the capability it calls read back.
import test from "node:test";
import assert from "node:assert/strict";
import { VoiceSettings } from "../pages/Voice.tsx";
import { createRoot } from "test-renderer";
import { mountPage } from "./page-kit.tsx";

const providers = [{ key: "deepgram", name: "Deepgram", keyUrl: "https://console.deepgram.com", models: [], languages: [] }];
const ME = { on: true, provider: "deepgram", language: "multi", model: "nova-3", source: "space", spaceOn: true, mayManage: true, providers };
const rows = (space: Record<string, unknown>) => ({ "talk.status": ME, "talk.space.status": space });
const NOW = Date.now();
const ON = { set: true, on: true, provider: "deepgram", setBy: "usr_ada", checkedAt: NOW - 4 * 60_000, state: "ok", peopleOwnKey: 2 };

test("the page opens with the intro and a status row that says how the Space stands", async () => {
  for (const [space, headline] of [[{ set: false, on: false }, "Not set up"], [ON, "On for everyone"], [{ ...ON, on: false }, "Off for everyone"]] as const) {
    const p = await mountPage(createRoot, <VoiceSettings />, rows(space));
    try {
      const t = p.text();
      assert.ok(t.includes("Press the mic and your words land in the message. One key here covers everyone, and nobody can read it."), "intro");
      assert.ok(t.includes(headline), headline);
      assert.ok(p.has("icon-tile-mic"), "mic tile");
    } finally { p.restore(); }
  }
});

test("set up: the sub-line names who added it and when it was checked, with the working state and the own-key row", async () => {
  const p = await mountPage(createRoot, <VoiceSettings />, rows(ON));
  try {
    const t = p.text();
    assert.ok(t.includes("Deepgram") && t.includes("added it") && t.includes("checked"), t);
    assert.ok(t.includes("Working") && t.includes("People with their own key") && t.includes("2. Their own key wins for them"));
    assert.ok(!t.includes("Needs you"), "a good check raises nothing");
  } finally { p.restore(); }
});

test("not set up: the key form shows, and Turn on for everyone calls connect with the key", async () => {
  const p = await mountPage(createRoot, <VoiceSettings />, rows({ set: false, on: false }));
  try {
    assert.ok(p.text().includes("Goes straight to this Space's Vault and is checked at once."));
    assert.ok(p.has("voice-key") && !p.has("voice-toggle"));
    await p.type("voice-key", "dg-secret");
    await p.press("voice-save");
    const c = p.called("talk.space.connect")[0];
    assert.ok(c, "connect asked for");
    assert.equal(c.input.provider, "deepgram");
    assert.deepEqual((c.input.fields as { key: string; value: string }[])[0], { key: "api_key", value: "dg-secret", secret: true });
  } finally { p.restore(); }
});

test("Turn off and Turn on call configure with the other state", async () => {
  const off = await mountPage(createRoot, <VoiceSettings />, rows(ON));
  try {
    await off.press("voice-toggle");
    assert.deepEqual(off.called("talk.space.configure")[0]?.input, { on: false });
  } finally { off.restore(); }
  const on = await mountPage(createRoot, <VoiceSettings />, rows({ ...ON, on: false }));
  try {
    assert.ok(on.text().includes("Turn on"));
    await on.press("voice-toggle");
    assert.deepEqual(on.called("talk.space.configure")[0]?.input, { on: true });
  } finally { on.restore(); }
});

test("Check now calls check", async () => {
  const p = await mountPage(createRoot, <VoiceSettings />, rows(ON));
  try {
    await p.press("voice-check");
    assert.equal(p.called("talk.space.check").length, 1);
  } finally { p.restore(); }
});

test("Replace key opens the form, and saving calls connect; Cancel closes it", async () => {
  const p = await mountPage(createRoot, <VoiceSettings />, rows(ON));
  try {
    await p.press("voice-replace");
    assert.ok(p.has("voice-key") && p.has("voice-cancel"));
    await p.type("voice-key", "new-key");
    await p.press("voice-save");
    assert.equal(p.called("talk.space.connect").length, 1);
    await p.press("voice-replace");
    await p.press("voice-cancel");
    assert.ok(!p.has("voice-key"));
  } finally { p.restore(); }
});

test("Remove key asks first, then calls disconnect", async () => {
  const p = await mountPage(createRoot, <VoiceSettings />, rows(ON));
  try {
    await p.press("voice-remove");
    assert.equal(p.called("talk.space.disconnect").length, 0, "one press only asks");
    await p.press("voice-remove-yes");
    assert.equal(p.called("talk.space.disconnect").length, 1);
  } finally { p.restore(); }
});

test("a failed check puts Needs you at the top, and its button opens the key form", async () => {
  const p = await mountPage(createRoot, <VoiceSettings />, rows({ ...ON, state: "failing" }));
  try {
    const t = p.text();
    assert.ok(t.includes("Needs you") && t.includes("The key stopped working") && t.includes("Not working"));
    await p.press("voice-need-replace");
    assert.ok(p.has("voice-key"));
  } finally { p.restore(); }
});
