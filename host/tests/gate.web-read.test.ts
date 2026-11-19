// chrome_read from an agent: no one is asked for a host its own search showed it in this turn or one on the person's Browser connections list; any other address waits for a person. A person's own read
// never waits, and anything the Gate cannot read holds.
import test from "node:test";
import assert from "node:assert/strict";
import { moduleWhens } from "../src/daemon/gate-hook.ts";
import { forgetWebTurns, rememberSearchHosts, webTurnKey } from "../../lib/web-turns.ts";

const when = (sites: unknown = [{ host: "docs.vendor.example" }], readable = true) =>
  moduleWhens(
    new Map(),
    () => null,
    async () => null,
    async (cap) => {
      if (!readable) throw new Error("no");
      return cap === "browser.sites.list" ? { sites } : null;
    },
  )["computers.web_read_unapproved"]!;
const agent = (thread = "thr_1") =>
  ({ principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_dana", thread }) as never;
const person = { principal: { kind: "person", id: "usr_dana" } } as never;

test("a host the agent's own search showed it, in the same turn, opens without a person; a host it chose, or a look-alike, does not", async () => {
  forgetWebTurns();
  const w = when([]);
  rememberSearchHosts(webTurnKey("agt_a", "thr_1"), [
    "https://docs.example.com/api/auth",
    "https://other.example.org/x",
  ]);
  assert.equal(await w({ url: "https://docs.example.com/page?x=1" }, agent()), false, "shown by the search");
  assert.equal(await w({ url: "https://other.example.org/" }, agent()), false);
  assert.equal(await w({ url: "https://evil.example.net/?q=context" }, agent()), true, "its own choice waits");
  assert.equal(await w({ url: "https://a.docs.example.com/" }, agent()), true, "a subdomain was not shown");
  assert.equal(await w({ url: "https://example.com/" }, agent()), true, "a parent was not shown");
  assert.equal(await w({ url: "https://docs.example.com.evil.io/" }, agent()), true, "a look-alike");
  assert.equal(
    await w({ url: "https://docs.example.com/" }, agent("thr_2")),
    true,
    "another turn's search does not carry over",
  );
  forgetWebTurns();
  assert.equal(await w({ url: "https://docs.example.com/" }, agent()), true, "nothing remembered");
});

test("a host on the person's Browser connections list opens without a person, with its subdomains; a person's own read never waits; what cannot be read holds", async () => {
  forgetWebTurns();
  const w = when([{ host: "docs.vendor.example" }]);
  assert.equal(await w({ url: "https://docs.vendor.example/guide" }, agent()), false);
  assert.equal(await w({ url: "https://x.docs.vendor.example/guide" }, agent()), false);
  assert.equal(await w({ url: "https://vendor.example/" }, agent()), true, "the parent is not on the list");
  assert.equal(await w({ url: "https://anything.example/" }, person), false, "a person's own read");
  assert.equal(await w({ url: "not a url" }, agent()), true);
  assert.equal(
    await when([], false)({ url: "https://docs.vendor.example/" }, agent()),
    true,
    "an unreadable list holds",
  );
  assert.equal(
    await w({ url: "https://docs.vendor.example/" }, { principal: { kind: "agent", id: "agt_a" } } as never),
    true,
    "no asker holds",
  );
});
