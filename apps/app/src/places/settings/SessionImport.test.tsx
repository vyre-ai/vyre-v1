import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionImport } from "./SessionImport.tsx";
import { SettingsDataProvider } from "./data.tsx";
import { createSampleSettings, northwind } from "./sample.ts";
import { archiveRow, confirmedSessionInput } from "./session-import-model.ts";

test("Personal desktop Settings offers discovery before any history read or import write", () => {
  const sample = createSampleSettings(northwind);
  let calls = 0;
  const data = { ...sample.data, spaces: sample.data.spaces.map((s) => ({ ...s, kind: "personal" as const })),
    call: async () => { calls++; return { sessions: [] }; },
    sessionImporter: { discover: async () => { calls++; return []; }, preview: async () => { throw new Error("not selected"); } },
  };
  const html = renderToStaticMarkup(<SettingsDataProvider value={data}><SessionImport /></SettingsDataProvider>);
  assert.match(html, /Bring your sessions/);
  assert.match(html, /Find sessions/);
  assert.doesNotMatch(html, /Refresh archive|claude_code|Imported sessions/);
  assert.doesNotMatch(html, /Confirm import into Personal/);
  assert.equal(calls, 0);
});

test("Team Settings never offers or discovers local history", () => {
  const sample = createSampleSettings(northwind);
  assert.equal(renderToStaticMarkup(<SettingsDataProvider value={sample.data}><SessionImport /></SettingsDataProvider>), "");
});

test("confirmation needs a selected visible preview and always targets Personal", () => {
  assert.throws(() => confirmedSessionInput(null, 5), /Preview/);
  const preview = { source: { provider: "claude" as const, sessionId: "fixture", sessionKey: "claude:fixture" }, at: 4,
    session: { sourceSessionId: "fixture", title: "Fixture", startedAt: 1, messages: [{ sourceMessageId: "m1", role: "user" as const, text: "Visible fixture", at: 1 }] } };
  const input = confirmedSessionInput(preview, 3);
  assert.deepEqual(input.consent, { previewedAt: 4, confirmedAt: 4 });
  assert.deepEqual(input.destination, { kind: "personal" });
  assert.equal(input.provider, "claude_code");
  assert.deepEqual(confirmedSessionInput(preview, 3), input);
});

test("an archive row shows the source mark, one clean title line and the date, never the raw provider key", () => {
  const now = Date.UTC(2026, 9, 31, 12);
  const r = archiveRow({ provider: "claude_code", title: "  Fix the\n  login   bug \n and then more", startedAt: now - 2 * 3_600_000 }, now);
  assert.deepEqual(r, { mark: "claude", title: "Fix the login bug and then more", note: "2 hours ago" });
  assert.equal(archiveRow({ provider: "codex", title: "", startedAt: 0 }, now).mark, "openai");
  assert.equal(archiveRow({ provider: "codex", title: "", startedAt: 0 }, now).title, "Untitled session");
  assert.equal(archiveRow({ provider: "codex", title: "x" }, now).note, "");
});
