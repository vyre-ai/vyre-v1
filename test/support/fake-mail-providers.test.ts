// The stand-in for Google and Microsoft that the personal mail tests use: the pieces they rely on behave like the real services do.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMailProviders } from "./fake-mail-providers.ts";

const form = (o: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(o).toString() });
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

test("a code turns into tokens for its account; a refresh makes an access token; revoking ends both", async () => {
  const f = fakeMailProviders();
  f.open("google", "maya@gmail.test", [{ from: "pat@acme.test", subject: "Hi", text: "Hello" }]);
  const got = JSON.parse(await (await f.tokenFetch("https://oauth2.googleapis.com/token", form({ grant_type: "authorization_code", code: f.codeFor("maya@gmail.test") }))).text()) as { access_token: string; refresh_token: string };
  assert.equal(got.refresh_token, f.refreshOf("maya@gmail.test"));
  const profile = await f.http("https://gmail.googleapis.com/gmail/v1/users/me/profile", auth(got.access_token));
  assert.equal(JSON.parse(await profile.text()).emailAddress, "maya@gmail.test");
  const again = JSON.parse(await (await f.tokenFetch("https://oauth2.googleapis.com/token", form({ grant_type: "refresh_token", refresh_token: got.refresh_token }))).text()) as { access_token: string };
  assert.notEqual(again.access_token, got.access_token);
  f.revoke("maya@gmail.test");
  assert.equal((await f.http("https://gmail.googleapis.com/gmail/v1/users/me/profile", auth(again.access_token))).status, 401);
  assert.equal((await f.tokenFetch("https://oauth2.googleapis.com/token", form({ grant_type: "refresh_token", refresh_token: got.refresh_token }))).status, 400);
});

test("Gmail: the list, one message, new mail since a history id, and a send that lands in Sent", async () => {
  const f = fakeMailProviders();
  f.open("google", "maya@gmail.test", [{ from: "pat@acme.test", subject: "Hi", text: "Hello" }]);
  const t = JSON.parse(await (await f.tokenFetch("https://oauth2.googleapis.com/token", form({ grant_type: "authorization_code", code: "code-maya@gmail.test" }))).text()).access_token as string;
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const list = JSON.parse(await (await f.http(`${base}/messages?q=x`, auth(t))).text()) as { messages: { id: string }[] };
  assert.equal(list.messages.length, 1);
  const msg = JSON.parse(await (await f.http(`${base}/messages/${list.messages[0]!.id}?format=full`, auth(t))).text());
  assert.equal(Buffer.from(msg.payload.body.data, "base64url").toString(), "Hello");
  const cursor = JSON.parse(await (await f.http(`${base}/profile`, auth(t))).text()).historyId as string;
  f.deliver("maya@gmail.test", { from: "lee@acme.test", subject: "Second", text: "More" });
  const hist = JSON.parse(await (await f.http(`${base}/history?startHistoryId=${cursor}`, auth(t))).text()) as { history: { messagesAdded: { message: { id: string } }[] }[] };
  assert.equal(hist.history.length, 1);
  const raw = Buffer.from("From: maya@gmail.test\r\nTo: pat@acme.test\r\nSubject: Re: Hi\r\n\r\nThanks").toString("base64url");
  await f.http(`${base}/messages/send`, { method: "POST", headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ raw }) });
  assert.deepEqual(f.sent, [{ email: "maya@gmail.test", to: ["pat@acme.test"], subject: "Re: Hi", text: "Thanks" }]);
});

test("Graph: me, a delta that only returns what is new after its token, a message and sendMail; two accounts never see each other's mail", async () => {
  const f = fakeMailProviders();
  f.open("microsoft", "ana@outlook.test", [{ from: "pat@acme.test", subject: "Hi", text: "Hello" }]);
  f.open("microsoft", "bo@outlook.test", [{ from: "kim@acme.test", subject: "Private", text: "B only" }]);
  const tok = async (e: string) => JSON.parse(await (await f.tokenFetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", form({ grant_type: "authorization_code", code: `code-${e}` }))).text()).access_token as string;
  const ta = await tok("ana@outlook.test");
  const tb = await tok("bo@outlook.test");
  const g = "https://graph.microsoft.com/v1.0";
  assert.equal(JSON.parse(await (await f.http(`${g}/me`, auth(ta))).text()).mail, "ana@outlook.test");
  const first = JSON.parse(await (await f.http(`${g}/me/mailFolders/inbox/messages/delta?$select=id`, auth(ta))).text()) as { value: { id: string }[]; "@odata.deltaLink": string };
  assert.equal(first.value.length, 1);
  assert.equal((await f.http(`${g}/me/messages/${first.value[0]!.id}`, auth(tb))).status, 404, "B cannot read A's message");
  f.deliver("ana@outlook.test", { from: "lee@acme.test", subject: "New", text: "Fresh" });
  const next = JSON.parse(await (await f.http(first["@odata.deltaLink"], auth(ta))).text()) as { value: { id: string }[] };
  assert.equal(next.value.length, 1);
  assert.equal((await f.http(`${g}/me/sendMail`, { method: "POST", headers: { authorization: `Bearer ${ta}` }, body: JSON.stringify({ message: { subject: "S", body: { content: "B" }, toRecipients: [{ emailAddress: { address: "x@y.test" } }] } }) })).status, 202);
  assert.equal(f.sent.length, 1);
});
