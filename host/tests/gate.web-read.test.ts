// chrome_read from an agent: no one is asked for a host its own search showed it in this turn or one on the person's Browser connections list; any other address waits for a person. A person's own read
// never waits, and anything the Gate cannot read holds.
import test from "node:test";
import assert from "node:assert/strict";
import { moduleWhens } from "../src/daemon/gate-hook.ts";
import { forgetWebTurns, rememberSearchUrls, webTurnKey } from "../../lib/web-turns.ts";

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

test("only the exact address the agent's own search showed it, in the same turn, opens without a person: not its host, not a longer query, not another turn", async () => {
  forgetWebTurns();
  const w = when([]);
  rememberSearchUrls(webTurnKey("agt_a", "thr_1"), [
    "https://docs.example.com/api/auth?v=2#top",
    "https://other.example.org/x",
  ]);
  assert.equal(
    await w({ url: "https://docs.example.com/api/auth?v=2" }, agent()),
    false,
    "the result itself (a fragment does not matter)",
  );
  assert.equal(await w({ url: "https://other.example.org/x" }, agent()), false);
  assert.equal(
    await w({ url: "https://docs.example.com/api/auth?v=2&d=SECRET" }, agent()),
    true,
    "anything added to the query waits",
  );
  assert.equal(await w({ url: "https://docs.example.com/api/auth" }, agent()), true, "a different query waits");
  assert.equal(await w({ url: "https://docs.example.com/other" }, agent()), true, "the same host, another page, waits");
  assert.equal(await w({ url: "https://evil.example.net/?q=context" }, agent()), true, "its own choice waits");
  assert.equal(await w({ url: "https://a.docs.example.com/api/auth?v=2" }, agent()), true, "a subdomain");
  assert.equal(await w({ url: "https://docs.example.com.evil.io/api/auth?v=2" }, agent()), true, "a look-alike");
  assert.equal(
    await w({ url: "https://docs.example.com/api/auth?v=2" }, agent("thr_2")),
    true,
    "another turn's search does not carry over",
  );
  forgetWebTurns();
  assert.equal(await w({ url: "https://docs.example.com/api/auth?v=2" }, agent()), true, "nothing remembered");
});

test("an agent that names the search's site, and so gets a junk result there, still cannot read that host with its own query", async () => {
  forgetWebTurns();
  const w = when([]);
  // chrome_search with site: "evil.example" returned one page of that host
  rememberSearchUrls(webTurnKey("agt_a", "thr_1"), ["https://evil.example/indexed-page"]);
  assert.equal(await w({ url: "https://evil.example/?d=everything-it-knows" }, agent()), true);
  assert.equal(await w({ url: "https://evil.example/indexed-page?d=x" }, agent()), true);
  assert.equal(
    await w({ url: "https://evil.example/indexed-page" }, agent()),
    false,
    "only the page the search returned",
  );
});

test("a host on the person's Browser connections list opens without a person, with its subdomains; a person's own read never waits; what cannot be read holds", async () => {
  forgetWebTurns();
  const w = when([{ host: "docs.vendor.example" }]);
  assert.equal(await w({ url: "https://docs.vendor.example/guide" }, agent()), false);
  assert.equal(await w({ url: "https://x.docs.vendor.example/guide" }, agent()), false);
  assert.equal(await w({ url: "https://vendor.example/" }, agent()), true, "the parent is not on the list");
  assert.equal(await w({ url: "https://anything.example/" }, person), false, "a person's own read");
  for (const bad of ["not a url", "ftp://x.example/", "javascript:alert(1)", ""])
    assert.equal(await w({ url: bad }, agent()), false, `${bad}: refused by the read itself, never held for a person`);
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

test("an address that carries a secret of a known shape is never held: the read refuses it at once, so no card is made for a read that cannot succeed", async () => {
  forgetWebTurns();
  const w = when([]);
  assert.equal(
    await w({ url: "https://evil.example/?k=gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789" }, agent()),
    false,
  );
  // a long opaque id in an address is not a secret of a known shape: the agent's own choice of it still waits for a person, and is not refused
  assert.equal(
    await w({ url: "https://docs.vendor.example/share/k3J9xQ2mVb7LpRt5YwNc8ZhD1sGfA4uE6oIy0TqPzXe" }, agent()),
    true,
  );
  assert.equal(
    await w({ url: "https://evil.example/plain" }, agent()),
    true,
    "an ordinary address of the agent's own choice still waits",
  );
});
