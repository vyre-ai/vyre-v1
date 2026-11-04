// What connecting GitHub and signing in with GitHub hand each other: used once, forgotten after minutes, never twice.
import test from "node:test";
import assert from "node:assert/strict";
import { createGithubTickets, LINK_PREFIX } from "./github-tickets.ts";
import { createGithub } from "./people.ts";

test("a link ticket is redeemed once, and only before it ends", () => {
  let now = 1_000;
  const t = createGithubTickets(() => now);
  const a = t.mintLink({ id: "4242", login: "maya-codes" });
  assert.ok(a.startsWith(LINK_PREFIX));
  assert.deepEqual(t.takeLink(a), { id: "4242", login: "maya-codes" });
  assert.equal(t.takeLink(a), null);
  const b = t.mintLink({ id: "1", login: "x" });
  now += 11 * 60_000;
  assert.equal(t.takeLink(b), null);
  assert.equal(t.takeLink("vyre-gh-link.nonsense"), null);
});

test("tokens a sign-in left wait two minutes for that GitHub id and go to the first taker only", () => {
  let now = 1_000;
  const t = createGithubTickets(() => now);
  t.holdPending({ id: "4242", login: "maya-codes" }, { accessToken: "a", refreshToken: "r", expiresAt: 5 });
  assert.equal(t.takePending("9"), null);
  assert.deepEqual(t.takePending("4242"), { login: "maya-codes", tokens: { accessToken: "a", refreshToken: "r", expiresAt: 5 } });
  assert.equal(t.takePending("4242"), null);
  t.holdPending({ id: "4242", login: "maya-codes" }, { accessToken: "a", refreshToken: "r", expiresAt: 5 });
  now += 3 * 60_000;
  assert.equal(t.takePending("4242"), null);
});

test("the sign-in exchange keeps the tokens GitHub gave (an app with expiring tokens) and tells the host when a sign-in finished", async () => {
  const tickets = createGithubTickets();
  const adopted: Array<[string, string]> = [];
  const f = (async (url: string) => ({ json: async () => (String(url).includes("access_token") ? { access_token: "ghu_s", refresh_token: "ghr_s", expires_in: 28800 } : { id: 4242, login: "maya-codes" }) })) as never;
  const gh = createGithub({ clientId: "c", clientSecret: "s", fetch: f }, tickets, async (id, person) => { adopted.push([id, person]); });
  assert.deepEqual(await gh.resolve("code1"), { id: "4242", login: "maya-codes" });
  assert.equal(tickets.takePending("4242")?.tokens.refreshToken, "ghr_s");
  await gh.signedIn!("4242", "usr_maya");
  assert.deepEqual(adopted, [["4242", "usr_maya"]]);
  const noTokens = createGithub({ clientId: "c", clientSecret: "s", fetch: (async (url: string) => ({ json: async () => (String(url).includes("access_token") ? { access_token: "ghu_s" } : { id: 7, login: "x" }) })) as never }, tickets);
  await noTokens.resolve("c");
  assert.equal(tickets.takePending("7"), null, "an app with no expiring tokens leaves nothing to adopt");
});
