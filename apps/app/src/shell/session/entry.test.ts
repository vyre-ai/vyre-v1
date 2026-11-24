import test from "node:test";
import assert from "node:assert/strict";
import {
  browserLink,
  claimAppLink,
  consumeBrowserInvite,
  forgetAddressChecks,
  inviteAppLink,
  entryTarget,
  isPhoneAddress,
  isRelayAddress,
  underRelayShell,
} from "./entry.ts";
import { probeDirectSpace } from "../../../../../client/src/gateway/space-probe.ts";

test("Space entry accepts canonical invite and claim links without treating them as plain sign-in addresses", () => {
  assert.deepEqual(entryTarget("https://team.example/join/ABCD-EFGH#fp=ab12cd34"), {
    kind: "join",
    address: "https://team.example",
    code: "ABCD-EFGH",
    fingerprint: "ab12cd34",
  });
  assert.deepEqual(entryTarget("team.example"), { kind: "signin", address: "https://team.example" });
  assert.equal(entryTarget("https://team.example/claim/abcdefghijklmnopqrstuvwxyz#s=spc_fixture")?.kind, "claim");
  for (const input of [
    "https://user:password@team.example",
    "javascript:alert(1)",
    "javascript:/join/ABCD-EFGH#fp=ab12cd34",
    "file:///join/ABCD-EFGH#fp=ab12cd34",
    "https://team.example/join/ABCD-EFGH",
    "https://team.example/unknown",
    "https://team.example/join/ABCD-EFGH#fp=%00",
  ])
    assert.equal(entryTarget(input), null, input);
});

test("Spent browser invites leave history before the shell remounts; ordinary app links remain", () => {
  const replaced: string[] = [];
  const history = {
    replaceState(_data: unknown, _unused: string, url: string) {
      replaced.push(url);
    },
  };
  consumeBrowserInvite({ location: { pathname: "/join/ABCD-EFGH" }, history });
  consumeBrowserInvite({ location: { pathname: "/tasks" }, history });
  assert.deepEqual(replaced, ["/chat"]);
});

test("Desktop invite handoff encodes only the existing HTTPS join protocol and keeps local web invites in the browser", () => {
  const route = { kind: "join" as const, address: "https://space.example", code: "ABCD-EFGH", fingerprint: "ab12cd34" };
  const link = new URL(inviteAppLink(route)!);
  assert.equal(link.protocol, "vyre:");
  assert.equal(link.hostname, "join");
  assert.deepEqual(Object.fromEntries(link.searchParams), {
    address: route.address,
    code: route.code,
    fp: route.fingerprint,
  });
  assert.equal(inviteAppLink({ ...route, address: "http://127.0.0.1:8421" }), null);
});

test("A phone address invite keeps its code in the fragment and opens the same join; the desktop app is never offered for a phone address", () => {
  const key = "k".repeat(43);
  assert.deepEqual(entryTarget(`https://acme.vyre.run/join#c=ABCD-EFGH&k=${key}&fp=ab12cd34`), {
    kind: "join",
    address: "https://acme.vyre.run",
    code: "ABCD-EFGH",
    fingerprint: "ab12cd34",
    // the link as given is kept: its fragment holds the invite's key, which a browser needs to open it
    link: `https://acme.vyre.run/join#c=ABCD-EFGH&k=${key}&fp=ab12cd34`,
  });
  for (const bad of [
    "https://acme.vyre.run/join#c=ABCD-EFGH",
    "https://acme.vyre.run/join#fp=ab12cd34",
    "https://acme.vyre.run/join?x=1#c=ABCD-EFGH&fp=ab12cd34",
    "https://acme.vyre.run/join#c=abc&fp=ab12cd34",
  ])
    assert.equal(entryTarget(bad), null, bad);
  assert.equal(isPhoneAddress("https://acme.vyre.run"), true);
  assert.equal(isPhoneAddress("https://vyre.run"), false);
  assert.equal(isPhoneAddress("https://space.northwind.example"), false);
  assert.equal(
    inviteAppLink({ kind: "join", address: "https://acme.vyre.run", code: "ABCD-EFGH", fingerprint: "ab12cd34" }),
    null,
  );
  const replaced: string[] = [];
  consumeBrowserInvite({
    location: { pathname: "/join" },
    history: {
      replaceState(_d: unknown, _u: string, url: string) {
        replaced.push(url);
      },
    },
  });
  assert.deepEqual(replaced, ["/chat"]);
});

// rc.14: northwind.vyre.run is a Space server with its own DNS record and TLS, and the desktop app refused it as a relay phone address. The address is asked now, not guessed from its name.
const Northwind = "https://northwind.vyre.run";
const joinAt = (address: string) => ({ kind: "join" as const, address, code: "ABCD-EFGH", fingerprint: "ab12cd34" });
test("A direct Space on a vyre.run name (northwind-style) joins and signs in from the desktop app, and its browser pages offer the app", async () => {
  forgetAddressChecks();
  let asked = 0;
  const probe = async (origin: string) => {
    asked++;
    assert.equal(origin, Northwind);
    return true;
  };
  assert.equal(await isRelayAddress(Northwind, { probe, page: null as never }), false);
  assert.equal(await isRelayAddress(joinAt(Northwind).address, { probe }), false, "join");
  assert.equal(await isRelayAddress(Northwind, { probe }), false, "sign in");
  assert.equal(asked, 1, "a direct answer is kept for the session");
  const link = new URL(inviteAppLink(joinAt(Northwind), false)!);
  assert.equal(link.protocol, "vyre:");
  assert.equal(link.searchParams.get("address"), Northwind);
  assert.match(claimAppLink(Northwind, "clm_abcdefgh", "#fp=9f3c1a2b&s=spc_northwind", false)!, /^vyre:\/\/claim\?/);
  // a real probe against an northwind-style /healthz
  forgetAddressChecks();
  const healthz: typeof fetch = (async (input: RequestInfo | URL) =>
    String(input) === `${Northwind}/healthz`
      ? new Response(JSON.stringify({ ok: true, roles: ["space"], space: "spc_01JMLA" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response(null, { status: 404 })) as typeof fetch;
  assert.equal(
    await isRelayAddress(Northwind, {
      probe: (o) => probeDirectSpace(o, { fetch: healthz, timeoutMs: 500 }),
      page: null as never,
    }),
    false,
  );
});
test("A relay phone address is opened in the browser by the app (never a line telling the person to), and its pages never offer the app", async () => {
  forgetAddressChecks();
  let asked = 0;
  const probe = async () => {
    asked++;
    return false;
  };
  assert.equal(await isRelayAddress(joinAt("https://imran.vyre.run").address, { probe }), true);
  assert.equal(await isRelayAddress("https://imran.vyre.run", { probe }), true);
  assert.equal(asked, 2, "a relay answer is not kept: the next try asks again");
  // what the app hands the browser: the Space's own page for a sign-in, the invite for a join, the link as it was given when it carries the Space's key
  assert.equal(browserLink({ kind: "signin", address: "https://imran.vyre.run" }), "https://imran.vyre.run/chat");
  assert.equal(browserLink(joinAt("https://imran.vyre.run")), "https://imran.vyre.run/join/ABCD-EFGH#fp=ab12cd34");
  const spaceLink = `https://imran.vyre.run/#box=${"b".repeat(43)}`;
  assert.deepEqual(entryTarget(spaceLink), { kind: "signin", address: "https://imran.vyre.run", link: spaceLink });
  assert.equal(browserLink(entryTarget(spaceLink)!), spaceLink);
  const invite = `https://imran.vyre.run/join#c=ABCD-EFGH&k=${"k".repeat(43)}&fp=ab12cd34`;
  assert.equal(browserLink(entryTarget(invite)!), invite, "the invite's key goes with it");
  // a link that claims to be for one address and carries another's is never followed
  assert.equal(
    browserLink({ kind: "signin", address: "https://imran.vyre.run", link: "https://evil.example/#box=x" }),
    "https://imran.vyre.run/chat",
  );
  assert.equal(inviteAppLink(joinAt("https://imran.vyre.run"), true), null);
  assert.equal(claimAppLink("https://imran.vyre.run", "clm_abcdefgh", "#s=spc_northwind", true), null);
  // the relay's real answers: the shell page for /healthz and 405 for the sign-in options
  const relay: typeof fetch = (async (_i: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(null, { status: 405 })
      : new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
  assert.equal(
    await isRelayAddress("https://imran.vyre.run", {
      probe: (o) =>
        probeDirectSpace(o, {
          fetch: relay,
          timeoutMs: 500,
          routes: async () => [
            { method: "POST", path: "/v1/identity/sign_in_options", cap: "identity.sign_in_options", v: 1 },
          ],
        }),
      page: null as never,
    }),
    true,
  );
  // a page on the relay name runs under the phone shell's worker, which carries /healthz to the box: that page is a relay address without asking
  let probed = false;
  assert.equal(
    await isRelayAddress("https://imran.vyre.run", {
      page: { origin: "https://imran.vyre.run" },
      relayShell: () => true,
      probe: async () => {
        probed = true;
        return true;
      },
    }),
    true,
  );
  assert.equal(probed, false);
  assert.equal(
    underRelayShell({ serviceWorker: { controller: { scriptURL: "https://imran.vyre.run/__vyre/sw.js" } } }),
    true,
  );
  assert.equal(
    underRelayShell({ serviceWorker: { controller: { scriptURL: "https://northwind.vyre.run/sw.js" } } }),
    false,
  );
  assert.equal(underRelayShell({ serviceWorker: { controller: null } }), false);
  assert.equal(underRelayShell(undefined), false);
});
test("A probe that times out or fails falls back to the name rule, safely", async () => {
  forgetAddressChecks();
  const hang: typeof fetch = ((_i: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch;
  const t0 = Date.now();
  assert.equal(
    await isRelayAddress(joinAt("https://slow.vyre.run").address, {
      probe: (o) =>
        probeDirectSpace(o, {
          fetch: hang,
          timeoutMs: 50,
          routes: async () => [
            { method: "POST", path: "/v1/identity/sign_in_options", cap: "identity.sign_in_options", v: 1 },
          ],
        }),
    }),
    true,
  );
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(
    await isRelayAddress("https://broken.vyre.run", {
      probe: async () => {
        throw new Error("boom");
      },
      page: null as never,
    }),
    true,
  );
});
test("An own domain is unchanged and never probed, including vyre.example.com", async () => {
  forgetAddressChecks();
  const probe = async () => {
    throw new Error("an own domain is not asked");
  };
  for (const address of [
    "https://vyre.example.com",
    "https://space.northwind.example",
    "https://vyre.run",
    "https://a.b.vyre.run",
  ]) {
    assert.equal(await isRelayAddress(address, { probe }), false, address);
    assert.equal(browserLink(joinAt(address)), `${address}/join/ABCD-EFGH#fp=ab12cd34`, address);
    assert.ok(inviteAppLink(joinAt(address)), address);
  }
  assert.equal(
    browserLink({ kind: "claim", address: "https://imran.vyre.run", url: "https://imran.vyre.run/claim/x" }),
    "https://imran.vyre.run/claim/x",
    "an owner link goes to a browser as it is",
  );
});

test("One address box: a bare name is that name under vyre.run, and an address copied from the browser while in the Space names the Space", () => {
  assert.deepEqual(entryTarget("northwind"), { kind: "signin", address: "https://northwind.vyre.run" });
  assert.deepEqual(entryTarget("  Northwind "), { kind: "signin", address: "https://northwind.vyre.run" });
  assert.deepEqual(entryTarget("northwind.vyre.run"), { kind: "signin", address: "https://northwind.vyre.run" });
  assert.deepEqual(entryTarget("https://northwind.vyre.run/"), {
    kind: "signin",
    address: "https://northwind.vyre.run",
  });
  for (const copied of [
    "https://northwind.vyre.run/chat",
    "https://northwind.vyre.run/records?skin=vyre-light#rec_1",
    "northwind.vyre.run/files",
  ])
    assert.deepEqual(entryTarget(copied), { kind: "signin", address: "https://northwind.vyre.run" }, copied);
  // localhost is this computer, never a name under vyre.run; a page that is not the app's stays no Space
  assert.deepEqual(entryTarget("localhost"), { kind: "signin", address: "https://localhost" });
  assert.equal(entryTarget("https://northwind.vyre.run/unknown"), null);
  assert.equal(entryTarget("https://northwind.vyre.run/join/ABCD-EFGH"), null, "a broken invite is not a sign-in");
});
