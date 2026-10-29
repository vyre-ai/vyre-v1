import test from "node:test";
import assert from "node:assert/strict";
import { linkChromeSpace, linksToChrome } from "./chrome-link.ts";
import type { StoredSession } from "./stored.ts";

const session = (over: Partial<StoredSession> & { kind?: string } = {}): StoredSession =>
  ({ baseUrl: "https://team.example", token: "session-token-1", personId: "usr_noah", marker: "m", def: { spaceId: "spc_team", name: "Team", kind: over.kind ?? "team" }, ...over }) as unknown as StoredSession;

test("only a Team Space reached over https is handed to the shell", () => {
  assert.equal(linksToChrome(session()), true);
  assert.equal(linksToChrome(session({ kind: "personal" })), false);
  assert.equal(linksToChrome(session({ baseUrl: "http://127.0.0.1:8425" })), false, "a Space this computer hosts needs no session");
  assert.equal(linksToChrome(session({ token: "" })), false);
  assert.equal(linksToChrome(session({ baseUrl: "not a url" })), false);
});

test("signing in links the Space with the person's own session, signing out unlinks it, and a browser does nothing", async () => {
  const calls: Array<[string, unknown]> = [];
  const unlink = linkChromeSpace(async (c, a) => { calls.push([c, a]); }, session());
  assert.deepEqual(calls, [["link_chrome_space", { id: "spc_team", name: "Team", address: "https://team.example", token: "session-token-1" }]]);
  unlink();
  assert.deepEqual(calls[1], ["unlink_chrome_space", { id: "spc_team" }]);
  linkChromeSpace(undefined, session())();
  const none: unknown[] = [];
  linkChromeSpace(async (c) => { none.push(c); }, session({ kind: "personal" }))();
  assert.deepEqual(none, []);
  // a failing shell never breaks the app
  linkChromeSpace(async () => { throw new Error("no shell"); }, session())();
});
