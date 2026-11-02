// The unsubscribe link in regular email: mail.send writes one per person when asked, the footer and the headers carry it, and mail.unsubscribe spends it. /u/<token> over a real socket is host/tests/unsubscribe.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { send } from "../handlers/send.ts";
import { setMailLinksHost, unsubscribe } from "../handlers/unsubscribe.ts";
import { codeOf, contractErrors } from "../fixtures/harness.ts";
import { rig, sendIn } from "./send.rig.test.ts";
import type { Rig } from "./send.rig.test.ts";

const tokenIn = (s: string): string => /\/u\/([A-Za-z0-9_-]+)/.exec(s)?.[1] ?? "";
const flow = { origin: "automation:aut_welcome", principal: { kind: "service", id: "svc_automations" } } as const;
const sentBody = (r: Rig, n = 0) => r.calls("resend.send_email")[n]!.input as { text?: string; html?: string; headers: Record<string, string>; to: string[] };
const optouts = (r: Rig) => r.calls("contacts.apply_optout");
function withOptout(r: Rig): void {
  const inner = r.ctx.call;
  r.ctx.call = async (cap, input) => {
    if (cap !== "contacts.apply_optout") return inner(cap, input);
    r.seen.push({ cap, input: input as Record<string, unknown> });
    assert.deepEqual(contractErrors(cap, "in", input), []);
    if (r.state.failNext !== null) { r.state.failNext = null; throw new Error("the opt-out did not land"); }
    return { suppressionId: "sup_1" };
  };
}

test.beforeEach(() => setMailLinksHost({ publicBase: "https://harbor.vyre.run/" }));
test.afterEach(() => setMailLinksHost(null));

test("a message that asks for it carries the link in the text and the one-click headers, and the table holds only a hash", async () => {
  const r = rig(flow);
  await send(r.ctx, sendIn({ unsubscribe: true }));
  const body = sentBody(r);
  const token = tokenIn(body.text ?? "");
  assert.match(token, /^[A-Za-z0-9_-]{16,}$/, body.text);
  assert.match(body.text ?? "", /Hi Pat\n\nTo stop these emails: https:\/\/harbor\.vyre\.run\/u\//);
  assert.equal(body.headers["List-Unsubscribe"], `<https://harbor.vyre.run/u/${token}>`);
  assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const stored = r.h.rows("SELECT * FROM mail_unsub");
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.address, "pat@acme.test");
  assert.ok(!JSON.stringify(stored).includes(token), "the token itself is not stored");
});

test("html gets the link before the end of the body", async () => {
  const r = rig(flow);
  await send(r.ctx, sendIn({ text: undefined, html: "<html><body><p>Hi</p></body></html>", unsubscribe: true }));
  assert.match(sentBody(r).html ?? "", /<p>Hi<\/p><p style="[^"]*"><a href="https:\/\/harbor\.vyre\.run\/u\/[^"]+">Unsubscribe<\/a><\/p><\/body>/);
});

test("on a phone address the link lives under /p, the only path the relay carries", async () => {
  setMailLinksHost({ publicBase: "https://harbor.vyre.run", publicPath: true });
  const r = rig(flow);
  await send(r.ctx, sendIn({ unsubscribe: true }));
  assert.match(sentBody(r).text ?? "", /https:\/\/harbor\.vyre\.run\/p\/u\/[A-Za-z0-9_-]+$/);
});

test("mail nobody asked a link for has none: a person's message, a sign-in link", async () => {
  const r = rig();
  await send(r.ctx, sendIn());
  const body = sentBody(r);
  assert.equal(body.text, "Hi Pat");
  assert.equal(body.headers["List-Unsubscribe"], undefined);
  assert.equal(r.h.rows("SELECT * FROM mail_unsub").length, 0);
});

test("with no public address the mail still goes, without a link that could open nothing", async () => {
  setMailLinksHost({});
  const r = rig(flow);
  assert.equal((await send(r.ctx, sendIn({ unsubscribe: true }))).status, "sent");
  assert.equal(sentBody(r).text, "Hi Pat");
});

test("several recipients get one message each with their own link, and a retry sends nothing twice", async () => {
  const r = rig(flow);
  const input = sendIn({ to: [{ address: "pat@acme.test" }, { address: "lee@acme.test" }], cc: [{ address: "sam@acme.test" }], unsubscribe: true });
  const out = await send(r.ctx, input);
  assert.equal(out.status, "sent");
  assert.deepEqual(r.calls("resend.send_email").map((c) => c.input.to), [["pat@acme.test"], ["lee@acme.test"], ["sam@acme.test"]]);
  assert.equal(new Set([0, 1, 2].map((n) => tokenIn(sentBody(r, n).text ?? ""))).size, 3);
  assert.deepEqual(r.h.rows("SELECT address FROM mail_unsub").map((x) => x.address).sort(), ["lee@acme.test", "pat@acme.test", "sam@acme.test"]);
  await send(r.ctx, input);
  assert.equal(r.calls("resend.send_email").length, 3);
});

test("a suppressed recipient is left out of a flow's send, and the rest get their link", async () => {
  const r = rig({ ...flow, suppressed: { "gone@acme.test": "unsubscribe" } });
  const out = await send(r.ctx, sendIn({ to: [{ address: "pat@acme.test" }, { address: "gone@acme.test" }], unsubscribe: true }));
  assert.deepEqual(out.suppressed, ["gone@acme.test"]);
  assert.deepEqual(r.calls("resend.send_email").map((c) => c.input.to), [["pat@acme.test"]]);
});

test("the link opts the address out once; used again it answers the same and writes nothing", async () => {
  const r = rig(flow);
  withOptout(r);
  await send(r.ctx, sendIn({ unsubscribe: true }));
  const token = tokenIn(sentBody(r).text ?? "");
  assert.deepEqual(await unsubscribe(r.ctx, { token }), { ok: true });
  assert.deepEqual(await unsubscribe(r.ctx, { token }), { ok: true });
  assert.equal(optouts(r).length, 1);
  assert.deepEqual(optouts(r)[0]!.input, { channel: "email", address: "pat@acme.test", keyword: "UNSUBSCRIBE", source: "link", at: r.ctx.now() });
});

test("a failed opt-out leaves the link good, so the retry takes effect", async () => {
  const r = rig(flow);
  withOptout(r);
  await send(r.ctx, sendIn({ unsubscribe: true }));
  const token = tokenIn(sentBody(r).text ?? "");
  r.state.failNext = "provider.rate_limited";
  await assert.rejects(unsubscribe(r.ctx, { token }), /did not land/);
  assert.equal(r.h.rows("SELECT used_at FROM mail_unsub")[0]!.used_at, null);
  assert.deepEqual(await unsubscribe(r.ctx, { token }), { ok: true });
  assert.notEqual(r.h.rows("SELECT used_at FROM mail_unsub")[0]!.used_at, null);
});

test("a token this Space never gave out is refused", async () => {
  const r = rig(flow);
  await send(r.ctx, sendIn({ unsubscribe: true }));
  await assert.rejects(unsubscribe(r.ctx, { token: "AbCdEfGhIjKlMnOpQrSt" }), (e: unknown) => codeOf(e) === "auth.invalid_code");
});
