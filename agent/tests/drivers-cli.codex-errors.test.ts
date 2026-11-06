// Codex's failures in plain words (lane l-codex, 6 Nov 2026), from the wording of codex-cli 0.166 itself and from real runs: a vendor error that arrives as a JSON document, a model the account does
// not have, a sign-in that is gone, and a usage limit with the time it lifts. None of the vendor's URLs, request ids or JSON reaches a person.
import test from "node:test";
import assert from "node:assert/strict";
import { codexErrorText, codexFailure, codexResetAt, createCodexDecoder } from "../src/drivers/cli/codex.ts";
import { classifyCli, goneModel, modelGone } from "../src/drivers/cli/errors.ts";

const NOW = new Date(2026, 10, 6, 10, 0).getTime();   // 6 Nov 2026 10:00, local

test("a vendor error sent as a JSON document is read for its message", () => {
  const raw = JSON.stringify({ type: "error", error: { message: "Invalid value: 'bogus'.", type: "invalid_request_error" }, status: 400 });
  assert.equal(codexErrorText(raw), "Invalid value: 'bogus'.");
  assert.equal(codexErrorText("plain words"), "plain words");
  assert.equal(codexErrorText("{not json"), "{not json");
});

test("a model the ChatGPT account does not have is a model_unavailable error, and the model is named", () => {
  const m = "The 'gpt-0-not-a-model' model is not supported when using Codex with a ChatGPT account.";
  assert.equal(modelGone(m), true);
  assert.equal(classifyCli(m), "engine.model_unavailable");
  assert.equal(goneModel(m), "gpt-0-not-a-model");
  assert.equal(codexFailure(m).message, m);
});

test("a signed-out Codex says so in plain words, with no URL or request id", () => {
  const raw = "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, cf-ray: a5607618eee0ff97-BOM, request id: req_294a16a0009b4384aa480aeaaf6c95d4";
  const f = codexFailure(raw);
  assert.equal(f.code, "provider.auth_failed");
  assert.match(f.message, /Sign in again/);
  assert.doesNotMatch(f.message, /https?:|cf-ray|req_/);
  assert.equal(codexFailure("Your access token could not be refreshed. Please log out and sign in again.").code, "provider.auth_failed");
});

test("a usage limit carries the time it lifts, as an instant", () => {
  const raw = "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Nov 9th, 2026 3:12 AM.";
  const f = codexFailure(raw, NOW);
  assert.equal(f.code, "provider.rate_limited");
  assert.equal(f.resetsAt, new Date(2026, 10, 9, 3, 12).getTime());
  assert.equal(f.message, "Codex reached its usage limit. It can be used again at Nov 9th, 2026 3:12 AM.");
  assert.doesNotMatch(f.message, /https?:/);
  // today: the time alone; a time already passed today is tomorrow's
  assert.equal(codexResetAt("You've hit your usage limit. Try again at 3:12 PM.", NOW), new Date(2026, 10, 6, 15, 12).getTime());
  assert.equal(codexResetAt("You've hit your usage limit. Try again at 3:12 AM.", NOW), new Date(2026, 10, 7, 3, 12).getTime());
  assert.equal(codexResetAt("12:05 AM try again at 12:05 AM", NOW), new Date(2026, 10, 7, 0, 5).getTime());
  assert.equal(codexResetAt("12:00 PM nothing", NOW), null);
});

test("a usage limit for one model, and one with no time, are still limits", () => {
  const a = codexFailure("You've hit your usage limit for GPT-6.1-Sol. Switch to another model now, or try again at Nov 8th, 2026 11:30 PM.", NOW);
  assert.equal(a.code, "provider.rate_limited");
  assert.equal(a.resetsAt, new Date(2026, 10, 8, 23, 30).getTime());
  const b = codexFailure("You've hit your usage limit. To get more access now, send a request to your admin.", NOW);
  assert.equal(b.code, "provider.rate_limited");
  assert.equal(b.resetsAt, undefined);
  assert.equal(b.message, "Codex reached its usage limit.");
});

test("the decoder ends a turn.failed with the plain failure, and a retry line is not the failure", () => {
  const d = createCodexDecoder();
  assert.deepEqual(d.push(JSON.stringify({ type: "error", message: "Reconnecting... 2/5 (unexpected status 401 Unauthorized)" })), []);
  const ev = d.push(JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit. Try again at Nov 9th, 2026 3:12 AM." } }));
  assert.equal(ev.length, 1);
  const end = ev[0] as { type: string; error: { code: string; resetsAt: number } };
  assert.equal(end.error.code, "provider.rate_limited");
  assert.equal(end.error.resetsAt, new Date(2026, 10, 9, 3, 12).getTime());
});
