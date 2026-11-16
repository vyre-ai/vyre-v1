// EVERY SERVICE THE CARD OFFERS FOR A PASTED KEY (r32-connect, 16 Nov 2026), run against a stand-in that answers the way the service's public documents say it does, and echoes the typed values back in its error body.
// Each service: the card finds it by name with its exact hosts; one real call goes out (a GET, or Zoom's documented token POST) to the one host the key is for, with the key in a header or Basic and never in an address;
// a wrong key, a key without the permission, a service that is down and a service that cannot be reached each say the one right thing; and no answer holds a typed value. A definition that is not exact is refused for each shape.
import test from "node:test";
import assert from "node:assert/strict";
import { CODE_BUILTINS } from "../../../lib/builtin-connectors.ts";
import { loadBuiltins } from "../impl.ts";
import { kit } from "../fixtures/kit.ts";
import { destinationProblem } from "../destination.ts";
import type { ConnectorDef } from "../projections.ts";

process.env["VYRE_CONNECT_CARD"] = "1";

interface Case {
  title: string;
  /** the connector the check goes to (the key of the one that is run) */
  key: string;
  host: string;
  method: "GET" | "POST";
  path: RegExp;
  /** how the key travels */
  sent: "bearer" | "basic" | "basic-key-only";
  wrong: { status: number; body: unknown };
  limited?: { status: number; body: unknown };
}
const CASES: Case[] = [
  {
    title: "Stripe",
    key: "stripe",
    host: "api.stripe.com",
    method: "GET",
    path: /^\/v1\/balance$/,
    sent: "bearer",
    wrong: { status: 401, body: { error: { type: "invalid_request_error", message: "Invalid API Key provided: " } } },
    limited: {
      status: 403,
      body: { error: { type: "invalid_request_error", message: "This key does not have the required permissions: " } },
    },
  },
  {
    title: "Resend",
    key: "resend",
    host: "api.resend.com",
    method: "GET",
    path: /^\/domains$/,
    sent: "bearer",
    wrong: { status: 400, body: { name: "validation_error", message: "API key is invalid " } },
    limited: {
      status: 401,
      body: { name: "restricted_api_key", message: "This API key is restricted to only send emails. " },
    },
  },
  {
    title: "HubSpot",
    key: "hubspot",
    host: "api.hubapi.com",
    method: "GET",
    path: /^\/account-info\/v3\/details$/,
    sent: "bearer",
    wrong: {
      status: 401,
      body: { status: "error", message: "Authentication credentials not found. ", category: "INVALID_AUTHENTICATION" },
    },
    limited: {
      status: 403,
      body: {
        status: "error",
        message: "This app hasn't been granted all required scopes. ",
        category: "MISSING_SCOPES",
      },
    },
  },
  {
    title: "Mailgun",
    key: "mailgun",
    host: "api.mailgun.net",
    method: "GET",
    path: /^\/v4\/domains$/,
    sent: "basic",
    wrong: { status: 401, body: { message: "Invalid private key " } },
    limited: { status: 403, body: { message: "Forbidden " } },
  },
  {
    title: "Mailgun EU",
    key: "mailgun-eu",
    host: "api.eu.mailgun.net",
    method: "GET",
    path: /^\/v4\/domains$/,
    sent: "basic",
    wrong: { status: 401, body: { message: "Invalid private key " } },
    limited: { status: 403, body: { message: "Forbidden " } },
  },
  {
    title: "Dropbox Sign",
    key: "dropbox-sign",
    host: "api.hellosign.com",
    method: "GET",
    path: /^\/v3\/account$/,
    sent: "basic-key-only",
    wrong: { status: 401, body: { error: { error_msg: "Unauthorized ", error_name: "unauthorized" } } },
    limited: { status: 403, body: { error: { error_msg: "Forbidden ", error_name: "forbidden" } } },
  },
  {
    title: "Zoom",
    key: "zoom",
    host: "zoom.us",
    method: "POST",
    path: /^\/oauth\/token$/,
    sent: "basic",
    wrong: { status: 400, body: { reason: "Invalid client_id or client_secret ", error: "invalid_client" } },
  },
  {
    title: "Twilio",
    key: "twilio",
    host: "api.twilio.com",
    method: "GET",
    path: /^\/2010-04-01\/Accounts\.json$/,
    sent: "basic",
    wrong: { status: 401, body: { code: 20003, message: "Authenticate ", status: 401 } },
    limited: { status: 403, body: { code: 20003, message: "Permission Denied ", status: 403 } },
  },
];

const setup = async () => {
  const k = kit({ builtins: loadBuiltins() });
  await k.hs["connectors.for_service"](k.ctx, { service: "nothing" });
  return k;
};
const defs = async (k: Awaited<ReturnType<typeof setup>>): Promise<ConnectorDef[]> =>
  k.tx.all<{ def: string }>("SELECT def FROM cn_connectors").map((r) => JSON.parse(r.def) as ConnectorDef);
const secretsFor = (def: ConnectorDef, tag: string): Record<string, string> =>
  Object.fromEntries(
    def.secrets
      .filter((s) => !/\boptional\b/i.test(s.description))
      .map((s) => [s.name, `SENT_${tag}_${s.name}_9f3a1c`]),
  );

for (const c of CASES) {
  test(`${c.title}: found by name with its exact host, tried with one real call, and every answer is only a verdict`, async () => {
    const k = await setup();
    const card = await k.hs["connectors.for_service"](k.ctx, { service: c.title });
    assert.equal(card.found, true, `${c.title} is offered by the card`);
    assert.equal(card.connector!.checks, true, "a call tries the key");
    assert.ok(card.connector!.hosts.includes(c.host), "the host of the check is one of the hosts shown");
    assert.ok(card.connector!.site?.startsWith("https://"), "a page for people where the key is found");
    const def = JSON.parse(
      k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", c.key)!.def,
    ) as ConnectorDef;
    const sec = secretsFor(def, c.key);
    const values = Object.values(sec);
    const echo = (r: { status: number; body: unknown }) => (): { status: number; body: unknown } => ({
      status: r.status,
      // the stand-in repeats every typed value (raw and as the Basic header it was sent in) in its error body
      body: JSON.stringify({ ...(r.body as object), echoed: values, header: k.sent.at(-1)?.headers }),
    });

    // a good key
    k.state.reply = () => ({
      status: 200,
      body: { object: "ok", accounts: [], data: [], items: [], access_token: "TOKEN_NOT_FOR_ANYONE", account: {} },
    });
    const ok = await k.hs["connectors.check_key"](k.ctx, { connector: c.key, secrets: sec });
    assert.equal(ok.result, "ok");
    assert.equal(k.sent.length, 1, "one call and nothing else");
    const one = k.sent[0]!;
    const u = new URL(one.url);
    assert.equal(one.method, c.method);
    assert.equal(u.hostname, c.host, "the key goes to the one host it is for");
    assert.equal(u.protocol, "https:");
    assert.match(u.pathname, c.path);
    assert.ok(
      !values.some((v) => one.url.includes(v) || one.url.includes(encodeURIComponent(v))),
      "no key in the address",
    );
    const auth = one.headers["Authorization"] ?? "";
    if (c.sent === "bearer") assert.equal(auth, `Bearer ${values[0]}`);
    else {
      assert.match(auth, /^Basic /);
      const plain = Buffer.from(auth.slice(6), "base64").toString();
      if (c.sent === "basic-key-only") assert.equal(plain, `${values[0]}:`);
      else assert.ok(plain.includes(":"));
      if (c.key.startsWith("mailgun")) assert.equal(plain, `api:${values[0]}`);
      if (c.key === "twilio") assert.equal(plain, `${sec["Twilio_Account"]}:${sec["Twilio_Auth"]}`);
      if (c.key === "zoom") assert.equal(plain, `${sec["Zoom_Client_Id"]}:${sec["Zoom_Client_Secret"]}`);
    }
    if (c.key === "zoom") {
      const form = new URLSearchParams(one.body ?? "");
      assert.equal(form.get("grant_type"), "account_credentials");
      assert.equal(form.get("account_id"), sec["Zoom_Account_Id"]);
      assert.match(one.headers["Content-Type"] ?? "", /x-www-form-urlencoded/);
    }
    assert.ok(!JSON.stringify(ok).includes("TOKEN_NOT_FOR_ANYONE"), "nothing of the answer is passed on");
    assert.deepEqual(Object.keys(ok).sort(), ["result", "tested"], "a verdict and one fixed line");

    // a wrong key: the stand-in echoes what it was sent, and the answer still holds none of it
    k.sent.length = 0;
    k.state.reply = echo(c.wrong);
    const bad = await k.hs["connectors.check_key"](k.ctx, { connector: c.key, secrets: sec });
    assert.deepEqual(bad, { result: "rejected" });

    // a key without the permission is not a wrong key
    if (c.limited) {
      k.state.reply = echo(c.limited);
      const lim = await k.hs["connectors.check_key"](k.ctx, { connector: c.key, secrets: sec });
      assert.deepEqual(lim, { result: "limited" }, "told apart from a wrong key");
    }

    // 5xx, 429, a refused connection and a timeout are never a verdict on the key
    for (const down of [
      () => ({ status: 500, body: JSON.stringify({ echoed: values }) }),
      () => ({ status: 503, body: "" }),
      () => ({ status: 429, body: JSON.stringify({ echoed: values }) }),
      () => new Error(`connect ECONNREFUSED ${values[0]}`),
      () => new Error(`timeout calling ${c.host} with ${values[0]}`),
    ]) {
      k.state.reply = down as never;
      const r = await k.hs["connectors.check_key"](k.ctx, { connector: c.key, secrets: sec });
      assert.deepEqual(r, { result: "unreachable" });
    }

    // nothing anywhere holds a typed value (the one place a key is kept is the Vault, and nothing was kept)
    const outside = JSON.stringify([k.events, k.logs, k.tx.all("SELECT * FROM cn_log"), k.calls]);
    for (const v of values) {
      assert.ok(!outside.includes(v), `${c.title}: no log, event, call or row holds the typed value`);
      assert.ok(!outside.includes(Buffer.from(v).toString("base64")), `${c.title}: nor its base64`);
    }
  });
}

test("a wrong key for a service whose answer names the key in its words is still only 'rejected', and an unclear 4xx is not a wrong key", async () => {
  const k = await setup();
  const sec = secretsFor(
    JSON.parse(k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = 'stripe'")!.def),
    "x",
  );
  k.state.reply = () => ({ status: 404, body: "no such thing" });
  assert.deepEqual(await k.hs["connectors.check_key"](k.ctx, { connector: "stripe", secrets: sec }), {
    result: "unreachable",
  });
  k.state.reply = () => ({ status: 400, body: "bad request" });
  assert.deepEqual(await k.hs["connectors.check_key"](k.ctx, { connector: "stripe", secrets: sec }), {
    result: "unreachable",
  });
});

test("Mailgun: the person picks one region; each region has exactly one host and the key never goes to both", async () => {
  const k = await setup();
  const card = (await k.hs["connectors.for_service"](k.ctx, { service: "Mailgun" })).connector!;
  assert.deepEqual(card.hosts, ["api.mailgun.net"]);
  assert.deepEqual(
    card.choice!.options.map((o) => [o.value, o.connector, o.hosts]),
    [
      ["us", "mailgun", ["api.mailgun.net"]],
      ["eu", "mailgun-eu", ["api.eu.mailgun.net"]],
    ],
  );
  for (const o of card.choice!.options) assert.equal(o.hosts.length, 1);
  const eu = (await k.hs["connectors.for_service"](k.ctx, { service: o_title(card, "eu") })).connector!;
  assert.deepEqual(eu.hosts, ["api.eu.mailgun.net"]);
  assert.equal(eu.choice, undefined, "the EU connector has no second choice");
  const sec = { Mailgun_Key: "SENT_mg_key_77" };
  k.state.reply = () => ({ status: 200, body: { items: [] } });
  await k.hs["connectors.check_key"](k.ctx, { connector: "mailgun-eu", secrets: sec });
  assert.deepEqual(
    k.sent.map((s) => new URL(s.url).hostname),
    ["api.eu.mailgun.net"],
  );
});
const o_title = (c: { choice?: { options: { value: string; connector: string }[] } }, v: string): string =>
  c.choice!.options.find((o) => o.value === v)!.connector;

test("every offered definition passes the destination rule as written, and is refused when it is made inexact in any of the shapes a key could be misdirected by", async () => {
  const k = await setup();
  const all = await defs(k);
  const builtins = all.filter((d) => d.builtin === true);
  for (const c of CASES) {
    const def = all.find((d) => d.key === c.key)!;
    assert.equal(destinationProblem(def, builtins), null, `${c.title} is exact as written`);
    const url = def.actions.find((a) => a.name === def.health)!.url!;
    const host = new URL(url).hostname;
    const swap = (to: string, from = host): ConnectorDef => ({
      ...def,
      domains: def.domains.map((d) => (d === from ? to : d)),
      actions: def.actions.map((a) => (a.url ? { ...a, url: a.url.split(from).join(to) } : a)),
    });
    // a published namesake is not built in: it is judged like anyone's, and never as a service the card is for
    const shapes: [string, ConnectorDef][] = [
      ["a wildcard domain", { ...def, domains: [...def.domains, `*.${host.split(".").slice(-2).join(".")}`] }],
      [
        "a wildcard that replaces the host",
        { ...def, domains: def.domains.map((d) => (d === host ? `*.${host}` : d)) },
      ],
      [
        "an http address",
        { ...def, actions: def.actions.map((a) => (a.url ? { ...a, url: a.url.replace("https://", "http://") } : a)) },
      ],
      ["a private address", swap("10.0.0.5")],
      ["an internal name", swap(`${host.split(".")[0]}.internal`)],
      ["localhost", swap("localhost")],
      ["a trailing dot", swap(`${host}.`)],
      ["a host in another alphabet", swap("xn--stripe-9ra.com")],
      ["a declared domain no action calls", { ...def, domains: [...def.domains, "elsewhere.example"] }],
      [
        "an action on a host that is not declared",
        { ...def, actions: [...def.actions, { name: "x", method: "GET", url: "https://elsewhere.example/x" }] },
      ],
      [
        "credentials in an address",
        {
          ...def,
          actions: def.actions.map((a) => (a.url ? { ...a, url: a.url.replace("https://", "https://user:pw@") } : a)),
        },
      ],
    ];
    for (const [what, bad] of shapes) {
      assert.notEqual(destinationProblem(bad, builtins), null, `${c.title}: ${what} is refused`);
    }
  }
});

test("every definition of this file is in the list of services the card is for, nothing else sends a key from a card", () => {
  assert.deepEqual(CODE_BUILTINS.map((c) => c.key).sort(), ["fathom", ...CASES.map((c) => c.key)].sort());
  for (const d of CODE_BUILTINS as readonly unknown[] as ConnectorDef[]) {
    for (const a of d.actions) {
      assert.ok(a.url?.startsWith("https://"), `${d.key}.${a.name} has an https address`);
      assert.ok(
        !/\{secret\./.test(a.url ?? "") && !/\{secret\./.test(JSON.stringify(a.query ?? {})),
        `${d.key}.${a.name}: no secret in an address`,
      );
      assert.ok(
        (a.method ?? "GET") === "GET" || (d.key === "zoom" && a.name === "token"),
        `${d.key}.${a.name} reads only (Zoom's token call is the one POST)`,
      );
    }
  }
});

test("Zoom: the token the token call hands out comes back from no call an agent or a person can make, only into the next call's header", async () => {
  const k = await setup();
  const def = JSON.parse(
    k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = 'zoom'")!.def,
  ) as ConnectorDef;
  const sec = secretsFor(def, "tok");
  k.state.reply = (req) =>
    req.url.includes("/oauth/token")
      ? { status: 200, body: { access_token: "ZTOK_unit_value_01" } }
      : { status: 200, body: { meetings: [], echoed: req.headers["Authorization"] } };
  const { executeAction } = await import("../handlers/runtime.ts");
  const alone = await executeAction(k.deps, k.ctx, def, "token", { secrets: sec, persist: false });
  assert.equal(alone.output, null, "on its own the token call answers nothing of the token");
  const next = await executeAction(k.deps, k.ctx, def, "list_meetings", { secrets: sec, persist: false });
  assert.equal(k.sent.at(-1)!.headers["Authorization"], "Bearer ZTOK_unit_value_01", "the next call carries it");
  assert.ok(!JSON.stringify(next).includes("ZTOK_unit_value_01"), "and nothing of it comes back");
});
