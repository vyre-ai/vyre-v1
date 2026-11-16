// EVERY LISTED SERVICE QUALIFIES OR IS NOT LISTED (b-connect3, 16 Nov 2026, V1-WHOLE row 6). The card is offered for a service only when its definition is exact: the hosts its key goes to are named, plain and public, the
// key has a shape, and how the key is checked is a real call or is said plainly to be none. Every built-in connector (the generated registry and the ones written as code) is stated here; a new one that is not stated fails
// this test, so nobody adds a service to the lists without saying where its key goes.
import test from "node:test";
import assert from "node:assert/strict";
import { CODE_BUILTINS } from "../../../lib/builtin-connectors.ts";
import { loadBuiltins } from "../impl.ts";
import { kit } from "../fixtures/kit.ts";
import { destinationProblem, notPublicHost } from "../destination.ts";
import type { ConnectorDef } from "../projections.ts";

process.env["VYRE_CONNECT_CARD"] = "1";

interface Stated {
  /** the card is offered for it */
  card: boolean;
  /** the exact hosts a key goes to (card: true), or the hosts its registry definition declares (card: false) */
  hosts: string[];
  /** what the key is */
  key: string;
  /** how a key is checked: a real call named, or why it cannot be */
  check: string;
  /** card: false only: why the card is not offered */
  why?: string;
}
const NAMED_ONLY =
  "its registry definition names actions without addresses, so the hosts a key would go to are not exact";
const STATED: Record<string, Stated> = {
  fathom: {
    card: true,
    hosts: ["api.fathom.ai"],
    key: "API key (header X-Api-Key) and an optional webhook secret",
    check: "GET https://api.fathom.ai/external/v1/meetings (list_meetings): a real call; 401 or 403 is a wrong key",
  },
  stripe: {
    card: false,
    hosts: ["api.stripe.com"],
    key: "secret key and a webhook secret",
    check: "cannot be checked from a card yet",
    why: NAMED_ONLY,
  },
  resend: {
    card: false,
    hosts: ["api.resend.com"],
    key: "API key and a webhook secret",
    check: "cannot be checked from a card yet",
    why: NAMED_ONLY,
  },
  hubspot: {
    card: false,
    hosts: ["api.hubapi.com", "app.hubspot.com"],
    key: "private app token",
    check: "cannot be checked from a card yet",
    why: NAMED_ONLY,
  },
  mailgun: {
    card: false,
    hosts: ["api.mailgun.net", "api.eu.mailgun.net"],
    key: "API key and a signing key",
    check: "cannot be checked from a card yet",
    why: NAMED_ONLY,
  },
  "dropbox-sign": {
    card: false,
    hosts: ["api.hellosign.com"],
    key: "API key",
    check: "cannot be checked from a card yet",
    why: NAMED_ONLY,
  },
  zoom: {
    card: false,
    hosts: ["api.zoom.us", "zoom.us"],
    key: "server-to-server OAuth credentials and a webhook secret",
    check: "cannot be checked from a card yet",
    why: NAMED_ONLY,
  },
  twilio: {
    card: false,
    hosts: ["api.twilio.com", "*.twilio.com"],
    key: "account SID, auth token, API key",
    check: "cannot be checked from a card yet",
    why: "a wildcard domain matches other hosts, and the actions have no addresses",
  },
  docusign: {
    card: false,
    hosts: ["*.docusign.net", "account.docusign.com"],
    key: "integration key",
    check: "cannot be checked from a card yet",
    why: "a wildcard domain matches other hosts, and the actions have no addresses",
  },
  google: {
    card: false,
    hosts: ["*.googleapis.com", "oauth2.googleapis.com", "meet.googleapis.com"],
    key: "domain-wide delegation key (a Google admin's own setup)",
    check: "its own setup page tests the delegation",
    why: "a wildcard domain matches other hosts; it is set up by a Google admin, not by pasting a key",
  },
  documenso: {
    card: false,
    hosts: ["documenso.internal"],
    key: "API token",
    check: "cannot be checked from a card yet",
    why: "its host is a private name (documenso.internal)",
  },
  github: {
    card: false,
    hosts: ["api.github.com", "github.com"],
    key: "GitHub App key, id and webhook secret",
    check: "its own setup creates the App from a manifest",
    why: "set up by creating a GitHub App, not by pasting a key",
  },
  github_signin: {
    card: false,
    hosts: ["api.github.com", "github.com"],
    key: "OAuth client secret",
    check: "the sign-in itself",
    why: "a sign-in, not a pasted key",
  },
  dropbox: {
    card: false,
    hosts: ["api.dropboxapi.com", "notify.dropboxapi.com"],
    key: "a sign-in (OAuth), no pasted key",
    check: "the sign-in itself",
    why: "a sign-in, not a pasted key",
  },
  microsoft: {
    card: false,
    hosts: ["graph.microsoft.com", "login.microsoftonline.com"],
    key: "an app registration (a sign-in)",
    check: "its own consent check",
    why: "a sign-in, not a pasted key",
  },
};

test("every built-in connector is stated here, and the card is offered for exactly the ones stated as on it", async () => {
  const k = kit({ builtins: loadBuiltins() });
  for (const c of CODE_BUILTINS) k.install(c as unknown as ConnectorDef);
  // reading seeds the registry's connectors
  await k.hs["connectors.for_service"](k.ctx, { service: "nothing" });
  const rows = k.tx.all<{ key: string; def: string; builtin: number }>(
    "SELECT key, def, builtin FROM cn_connectors WHERE builtin = 1 OR key IN ('fathom')",
  );
  const builtins = k.tx
    .all<{ key: string; def: string }>("SELECT key, def FROM cn_connectors")
    .map((r) => JSON.parse(r.def) as ConnectorDef);
  const keys = rows.map((r) => r.key).sort();
  assert.deepEqual(
    keys,
    Object.keys(STATED).sort(),
    "every built-in connector is stated, and nothing stated is missing",
  );
  for (const r of rows) {
    const def = JSON.parse(r.def) as ConnectorDef;
    const want = STATED[r.key]!;
    assert.ok(want.key.length > 0 && want.check.length > 0, `${r.key}: says what its key is and how it is checked`);
    const got = await k.hs["connectors.for_service"](k.ctx, { service: def.title });
    assert.equal(got.found, want.card, `${r.key}: card is ${want.card ? "offered" : "not offered"}`);
    if (want.card) {
      const hosts = got.connector!.hosts;
      assert.deepEqual(hosts, want.hosts, `${r.key}: exact hosts`);
      assert.equal(destinationProblem(def, builtins), null, `${r.key}: nothing wrong with where its key goes`);
      for (const h of hosts) {
        assert.ok(!h.includes("*"), `${r.key}: no wildcard`);
        assert.ok(!notPublicHost(h), `${r.key}: a public host`);
        assert.ok(def.domains.includes(h), `${r.key}: ${h} is a declared domain`);
      }
      assert.deepEqual(def.domains.slice().sort(), hosts.slice().sort(), `${r.key}: no domain beyond the hosts`);
      assert.ok(
        got.connector!.fields.some((f) => !f.optional),
        `${r.key}: a key to paste`,
      );
      assert.equal(got.connector!.checks, !/^cannot/.test(want.check), `${r.key}: the check is as stated`);
    } else {
      assert.ok(want.why && want.why.length > 0, `${r.key}: says why it is not offered`);
      assert.equal(got.older, def.title, `${r.key}: the answer says it keeps its older way`);
      assert.deepEqual(
        def.domains.slice().sort(),
        want.hosts.slice().sort(),
        `${r.key}: its declared hosts are as stated`,
      );
    }
  }
});

test("no listed service's declared domain is a wildcard or a bare suffix that another listed service's host sits under", async () => {
  const k = kit({ builtins: loadBuiltins() });
  for (const c of CODE_BUILTINS) k.install(c as unknown as ConnectorDef);
  await k.hs["connectors.for_service"](k.ctx, { service: "nothing" });
  const listed: ConnectorDef[] = [];
  for (const r of k.tx.all<{ key: string; def: string }>("SELECT key, def FROM cn_connectors")) {
    const def = JSON.parse(r.def) as ConnectorDef;
    if ((await k.hs["connectors.for_service"](k.ctx, { service: def.title })).found) listed.push(def);
  }
  assert.ok(listed.length >= 1);
  for (const a of listed) {
    for (const d of a.domains) assert.ok(!d.includes("*") && d.includes("."), `${a.key}: ${d} is one exact host`);
    for (const b of listed) {
      if (a.key === b.key) continue;
      for (const x of a.domains)
        for (const y of b.domains)
          assert.ok(
            !(x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)),
            `${a.key} and ${b.key} share ${x} / ${y}`,
          );
    }
  }
});

test("a built-in service that is not offered by the card says so to the agent, and tells it not to build a second connector", async () => {
  const k = kit({ builtins: loadBuiltins() });
  const got = await k.hs["connectors.for_service"](k.ctx, { service: "Stripe" });
  assert.deepEqual([got.found, got.older], [false, "Stripe"]);
});
