import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { InterviewCard } from "./InterviewCard.tsx";
import { ChromeCard, EXTENSION_ZIP_URL } from "./ChromeCard.tsx";
import { markKey } from "./ProviderLogo.tsx";
import { ConnectAiCard } from "./ConnectAiCard.tsx";

const call = (async () => ({})) as never;

test("How you work opens on a blank field with the three-dot progress, a hint to start typing, and Next disabled until something is picked", () => {
  const out = renderToStaticMarkup(<InterviewCard call={call} onSaved={() => undefined} />);
  assert.ok(out.includes('data-testid="interview-card"') && out.includes('data-testid="interview-work"') && out.includes("What do you do most?"));
  assert.ok(out.includes("Start typing, like accountant or designer"));
  assert.ok(!out.includes('data-testid="interview-suggestions"'), "no suggestions until something is typed");
  assert.ok(/aria-disabled="true"|disabled=""/.test(out), "Next waits for a pick");
});

test("the Chrome card is one button: Install in the desktop app, Download for Chrome on the web, and the zip is the release's", () => {
  const web = renderToStaticMarkup(<ChromeCard call={call} device="web" onConnected={() => undefined} />);
  assert.ok(web.includes('data-testid="chrome-add"') && web.includes("Download for Chrome") && !web.includes("Install"));
  const mac = renderToStaticMarkup(<ChromeCard call={call} device="mac" onConnected={() => undefined} />);
  assert.ok(mac.includes('data-testid="chrome-add"'));
  assert.equal(EXTENSION_ZIP_URL, "https://github.com/vyre-ai/vyre-v1/releases/latest/download/vyre-chrome.zip");
});

test("provider ids map to the real brand marks: Claude, OpenAI for ChatGPT and Codex, Grok", () => {
  assert.equal(markKey("claude-code"), "claude");
  assert.equal(markKey("anthropic"), "claude");
  assert.equal(markKey("codex"), "openai");
  assert.equal(markKey("openai"), "openai");
  assert.equal(markKey("grok"), "grok");
  assert.equal(markKey("xai"), "grok");
  assert.equal(markKey("nothing"), null);
  const out = renderToStaticMarkup(<ConnectAiCard call={call} onConnected={() => undefined} />);
  assert.equal((out.match(/<svg/g) ?? []).length, 3, "each of the three sign-in tiles carries its mark");
});
