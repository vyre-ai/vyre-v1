// The sign-in panel and its calls: what each provider's button shows, how a code is checked before it is sent, how a waiting sign-in differs from a refused one, and that only an https link opens.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SignInPanel } from "./SignInPanel.tsx";
import { SIGNIN_BUTTONS, checkFlow, nextLine, pastedCode, safeLink, startFlow } from "./flow.ts";
import type { Call, Flow } from "./flow.ts";

const html = (f: Flow): string => renderToStaticMarkup(<SignInPanel call={async () => ({})} flow={f} onDone={() => undefined} onCancel={() => undefined} />).replaceAll("<!-- -->", "");
const rec = (answers: Record<string, unknown>): { call: Call; calls: { cap: string; input: unknown }[] } => {
  const calls: { cap: string; input: unknown }[] = [];
  return { calls, call: async (cap, input) => { calls.push({ cap, input }); const a = answers[cap]; if (a instanceof Error) throw a; return a; } };
};
const coded = (message: string, code: string): Error => Object.assign(new Error(message), { code });

test("each provider has a Sign in with button", () => {
  assert.deepEqual(SIGNIN_BUTTONS.map((b) => b.button), ["Sign in with Claude", "Sign in with ChatGPT", "Sign in with Grok"]);
  assert.deepEqual(SIGNIN_BUTTONS.map((b) => b.key), ["claude-code", "codex", "grok"]);
});

test("Claude's panel: Open the sign-in, Copy link, a field for the pasted code, Finish and Cancel, and no code to type", () => {
  const out = html({ flowId: "sub_1", instruction: "x", url: "https://claude.ai/oauth/authorize?state=s", needsCode: true });
  for (const id of ["signin-open", "signin-copy", "signin-code", "signin-finish", "signin-cancel"]) assert.match(out, new RegExp(`data-testid="${id}"`), id);
  assert.match(out, /paste the code the page shows/);
  assert.doesNotMatch(out, /signin-usercode|signin-waiting/);
});

test("ChatGPT's panel: the code to type is shown big, there is no code field, and it says it finishes by itself", () => {
  const out = html({ flowId: "sub_2", instruction: "x", url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234", needsCode: false });
  assert.match(out, /data-testid="signin-usercode"[^>]*>ABCD-1234</);
  assert.match(out, /enter the code ABCD-1234\. This page finishes by itself/);
  assert.match(out, /data-testid="signin-waiting"/);
  assert.doesNotMatch(out, /signin-code"|signin-finish/);
});

test("a flow with no usable link says so and offers no Open button", () => {
  const out = html({ flowId: "sub_3", instruction: "x", url: "http://claude.ai/x", needsCode: true });
  assert.match(out, /data-testid="signin-nolink"/);
  assert.doesNotMatch(out, /data-testid="signin-open"/);
  assert.equal(safeLink("https://a@b.example/x"), null);
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("https://auth.openai.com/codex/device"), "https://auth.openai.com/codex/device");
});

test("a pasted code is one word of the marks a code carries, or it is not sent", () => {
  assert.equal(pastedCode("  AbC123_-.~#xyz789  "), "AbC123_-.~#xyz789");
  for (const bad of ["", "abc", "has space inside", "line\nbreak", "x".repeat(700)]) assert.equal(pastedCode(bad), null, JSON.stringify(bad));
  assert.equal(nextLine({ flowId: "s", instruction: "Sign in elsewhere.", needsCode: false }), "Sign in elsewhere.");
});

test("starting passes the provider and a key, and fills the flow from the answer", async () => {
  const r = rec({ "providers.subscription_start": { flowId: "sub_9", instruction: "Do it.", url: "https://claude.ai/x", needsCode: true } });
  assert.deepEqual(await startFlow(r.call, "claude-code", "k1"), { flowId: "sub_9", instruction: "Do it.", url: "https://claude.ai/x", needsCode: true });
  assert.deepEqual(r.calls[0], { cap: "providers.subscription_start", input: { providerKey: "claude-code", idempotencyKey: "k1" } });
  await assert.rejects(() => startFlow(rec({ "providers.subscription_start": new Error("Grok sign-in needs the Grok command line on this computer. Install it, or use an API key.") }).call, "grok", "k"), /Grok command line/);
  await assert.rejects(() => startFlow(rec({ "providers.subscription_start": new Error("validation.bad_input") }).call, "grok", "k"), /could not start/);
});

test("checking: waiting is not a failure, done carries the provider, a refusal carries the provider's words, a locked Vault says so", async () => {
  const send = (a: unknown, code?: string): Promise<unknown> => checkFlow(rec({ "providers.subscription_complete": a }).call, "sub_1", code);
  assert.deepEqual(await send({ waiting: true }), { state: "waiting" });
  assert.deepEqual(await send({ provider: { id: "prv_1" } }, "CODE12345"), { state: "done", provider: { id: "prv_1" } });
  assert.deepEqual(await send(coded("x", "validation.precondition_failed")), { state: "waiting" });
  await assert.rejects(() => send(coded("Claude did not accept that code. It may have expired. Start again.", "provider.auth_failed")), /did not accept that code/);
  await assert.rejects(() => send(coded("x", "auth.unauthenticated")), /Mine Vault is locked/);
  const r = rec({ "providers.subscription_complete": { waiting: true } });
  await checkFlow(r.call, "sub_1", "ABCDEF123");
  assert.deepEqual(r.calls[0]!.input, { flowId: "sub_1", code: "ABCDEF123" });
});
