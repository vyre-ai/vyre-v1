// "Signed in on its browser" lists only sites an agent signed in to (13 Nov 2026, owner on rc.26: the list showed "127.0.0.1, since 13 Nov"). browserd lists every host that holds a cookie, so the
// browser's own start page and addresses inside the Space came through as sign-ins. The list a person reads leaves out loopback, private and internal addresses and names that are no site.
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { isSignInSite, signInSites } from "../sbrowser/sites.ts";
import { DANA, harness } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const KEPT = [
  "app.clio.com",
  "mail.google.com",
  "login.microsoftonline.com",
  "accounts.example.co.uk",
  "8.8.8.8",
  "xn--bcher-kva.example",
  // a firm's own systems on its network are real sign-ins and stay, so the person can see them and sign out
  "10.0.0.5",
  "172.18.0.4",
  "192.168.1.20",
  "dms.firm.local",
  "files.office.lan",
  "wiki.corp.internal",
  "dms",
  "intranet",
  "100.64.0.9",
  "mylocalhost.com",
  "localhost.example.com",
];
const LEFT_OUT = [
  "127.0.0.1",
  "127.1.2.3",
  "127.0.0.1:3000",
  "127.0.0.1.",
  "localhost",
  "localhost.",
  "localhost:8080",
  "LOCALHOST",
  "start.localhost",
  "::1",
  "[::1]",
  "[::1]:3000",
  "0.0.0.0",
  "::",
  "vyre-sbrowser",
  "vyre-sbrowser-test-ab12",
  "vyre-space-browser",
  "host.docker.internal",
  "vyred",
  "",
  " ",
  ".",
  "about:blank",
  "chrome://newtab",
  "a b",
];

test("the sites that count as a sign-in are real sites, never the browser's own addresses", () => {
  for (const s of KEPT) assert.equal(isSignInSite(s), true, `${s} is a site`);
  for (const s of KEPT.map((x) => `.${x}`))
    assert.equal(isSignInSite(s), true, `${s} (a cookie's leading dot) is a site`);
  for (const s of LEFT_OUT)
    assert.equal(isSignInSite(s), false, `${JSON.stringify(s)} is not a site an agent signed in to`);
  assert.deepEqual(
    signInSites([...LEFT_OUT, ...KEPT].map((site) => ({ site, since: 1 }))).map((x) => x.site),
    KEPT,
    "the order given is kept",
  );
});

test("computers.browser.sessions answers without the browser's own addresses, even from a list browserd kept before", async () => {
  const sb = {
    async available() {
      return true;
    },
    async profiles() {
      return { profiles: [], maxRunning: 6 };
    },
    async health() {
      return { ok: true };
    },
    async sessions() {
      return [
        { site: "127.0.0.1", since: 5, lastSeen: 6 },
        { site: "app.clio.com", since: 5, lastSeen: 6 },
        { site: "about:blank", since: 5, lastSeen: 6 },
      ];
    },
  } as unknown as SpaceBrowser;
  bindSpaceBrowser(sb);
  try {
    const h = harness({
      principal: { kind: "person", id: DANA },
      manager: false,
      respond: { "agents.share_class": () => ({ ownerId: DANA, class: "private", people: [] }) },
    });
    assert.deepEqual((await tool["computers.browser.sessions"]!(h.ctx, { agentId: "agt_dana_ast" })).sessions, [
      { site: "app.clio.com", since: 5, lastSeen: 6 },
    ]);
  } finally {
    bindSpaceBrowser(null);
  }
});
