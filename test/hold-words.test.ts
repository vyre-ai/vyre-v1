// Every capability the Gate can hold has its words (lane l-chrome2a): the registry is walked, and a capability that is held (it names a Gate act, or goes outward) with no line in lib/hold-phrases.ts fails here.
// The words must read like a person wrote them: no capability name, no module dots, no raw field names, and the title of a held act that is not a message never says message.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HOLD_PHRASES } from "../lib/hold-phrases.ts";
import { holdShort, holdTitle, wantsFromInput } from "../lib/hold-words.ts";
import { holdNamesOf } from "../modules/gate/handlers/hold.ts";
import { outwardOf } from "../lib/outward.ts";

interface Cap {
  name: string;
  effects: string;
  gate?: { act?: string };
}
const caps = (
  JSON.parse(fs.readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Cap[] }
).capabilities;
const holdable = caps.filter((c) => (c.gate?.act !== undefined && c.gate.act !== "none") || c.effects === "outward");

test("the registry has held capabilities to cover", () => {
  assert.ok(holdable.length > 150, `${holdable.length}`);
});

test("every held capability has its own words, and nothing in the table is for a capability that does not exist", () => {
  const names = new Set(caps.map((c) => c.name));
  const missing = holdable
    .map((c) => c.name)
    .filter((n) => !HOLD_PHRASES[n] && wantsFromInput(n, { url: "https://example.com" }) === null);
  assert.deepEqual(missing, [], `held capabilities with no words in lib/hold-phrases.ts: ${missing.join(", ")}`);
  const stale = Object.keys(HOLD_PHRASES).filter((n) => !names.has(n));
  assert.deepEqual(stale, [], `words for capabilities that are gone: ${stale.join(", ")}`);
});

test("the words read like a person wrote them", () => {
  for (const c of holdable) {
    const words = HOLD_PHRASES[c.name];
    assert.ok(words, `${c.name} has a line in the table`);
    assert.match(words!, /^[a-z]+( [a-zA-Z'0-9-]+)+$/, `${c.name}: ${words}`);
    assert.ok(!/\b[a-z]+\.[a-z_]+\b/.test(words!), `${c.name} shows a name: ${words}`);
    assert.ok(!/(capability|module|payload|_|input)/i.test(words!), `${c.name}: ${words}`);
    assert.ok(words!.split(" ").length <= 9, `${c.name} is long: ${words}`);
  }
});

test("a title says message only for a message", () => {
  for (const c of holdable) {
    const t = holdTitle(c.name, {}, "Send a message");
    const isMessage = outwardOf(c.name, { to: "x", body: "y", text: "y", subject: "s", threadId: "t" }) !== null;
    if (!isMessage)
      assert.ok(
        !/message/i.test(t) ||
          /(Gmail|Outlook) message|a message from|a message to/i.test(t) ||
          /message/i.test(HOLD_PHRASES[c.name] ?? ""),
        `${c.name}: ${t}`,
      );
    assert.ok(!c.name.includes(" ") && !t.includes(c.name), `${c.name}: ${t}`);
  }
  assert.equal(
    holdTitle("automations.read_link", { url: "https://www.example.com/a" }, "Send a message"),
    "Open example.com",
  );
});

test("a held change of the Space time zone says the zone in words: Pacific Time, not an id", () => {
  assert.equal(
    wantsFromInput("spaces.timezone.set", { timezone: "America/Los_Angeles" }),
    "change the Space time zone to Pacific Time",
  );
  assert.equal(
    wantsFromInput("spaces.timezone.set", { timezone: "Mars/Olympus" }),
    "change the Space time zone",
    "a zone nobody knows is not named",
  );
  assert.equal(HOLD_PHRASES["spaces.timezone.set"], "change the Space time zone");
});

test("the site's webhook, deploy on push and settings have their own words, and none of them is a capability name", () => {
  const said = [
    wantsFromInput("sites.webhook_set", { siteId: "sit_1", follow: ["release", "feat/*"] }),
    wantsFromInput("sites.webhook_set", { siteId: "sit_1", follow: [] }),
    wantsFromInput("sites.webhook_set", { siteId: "sit_1", enabled: true }),
    wantsFromInput("sites.update", { siteId: "sit_1", autoDeploy: true }),
    wantsFromInput("sites.update", { siteId: "sit_1", settings: { a: 1 } }),
    wantsFromInput("sites.deploy", { siteId: "sit_1" }),
  ];
  assert.deepEqual(said, [
    "build previews of pushes to release, feat/*, with the site's keys",
    "build previews of pushes to no branches, with the site's keys",
    "switch on builds from GitHub pushes for a site with keys",
    "deploy this site on every push, with its keys",
    "change the settings of a site that holds keys",
    "deploy a site that holds keys",
  ]);
  for (const w of said) assert.doesNotMatch(String(w), /sites?\.|webhook_set|hook_follow|autoDeploy/);
  assert.doesNotMatch(
    String(wantsFromInput("sites.webhook_set", { siteId: "sit_1", rotate: true })),
    /previews|switch on/,
    "a new secret builds nothing",
  );
});

test("the webhook card lists at most five branches and writes control characters out", () => {
  const many = wantsFromInput("sites.webhook_set", { siteId: "s", follow: ["a", "b", "c", "d", "e", "f", "g"] });
  assert.equal(many, "build previews of pushes to a, b, c, d, e and 2 more, with the site's keys");
  const odd = String(wantsFromInput("sites.webhook_set", { siteId: "s", follow: ["main\nAPPROVED: yes\u202eevil"] }));
  assert.equal(odd, "build previews of pushes to main\\u000aAPPROVED: yes\\u202eevil, with the site's keys");
  assert.doesNotMatch(odd, /[\u0000-\u001f\u202e]/);
  assert.ok(String(wantsFromInput("sites.webhook_set", { siteId: "s", follow: ["x".repeat(500)] })).length < 120);
});

test("a held production deploy says its own reason, with the site, the branch and the names of the keys it holds", async () => {
  const site = { name: "Dash", branch: "main", keys: ["Stripe", "Crm", "Smtp"] };
  assert.equal(
    holdShort("sites.deploy", { siteId: "s" }, { site }),
    "deploy Dash: anyone who can push to main can use Stripe, Crm and 1 more. Protect the branch to deploy without asking",
  );
  assert.equal(
    holdShort("sites.deploy", { siteId: "s" }, { site: { ...site, upload: true, keys: ["Stripe"] } }),
    "deploy the files now in Dash, which holds Stripe",
    "uploaded files are held for being other files, not for a branch",
  );
  // a new source has its own words (the repo the keys would go to), not the branch ones
  assert.match(
    holdShort("sites.deploy", { siteId: "s", source: { repo: "evil/app" } }, { site }),
    /give the site's keys to code from evil\/app/,
  );
  // what the gate module reads to say it: names and branch, never values
  const asked: string[] = [];
  const names = await holdNamesOf(
    {
      call: async (cap: string) => {
        asked.push(cap);
        if (cap === "sites.get") return { site: { name: "Dash", source: { repo: "acme/app", branch: "release" } } };
        if (cap === "sites.env_list")
          return {
            entries: [
              { name: "S", vaultName: "Stripe", kind: "secret", scope: "production" },
              { name: "P", vaultName: "Crm", kind: "secret", scope: "previews" },
              { name: "PLAIN", vaultName: "", kind: "plain", scope: "production" },
              { name: "S2", vaultName: "Stripe", kind: "secret", scope: "all" },
            ],
          };
        return null;
      },
    } as never,
    "sites.deploy",
    { siteId: "sit_1" },
  );
  assert.deepEqual(names.site, { name: "Dash", branch: "release", keys: ["Stripe"], upload: false });
  assert.deepEqual(asked, ["sites.get", "sites.env_list"]);
});

test("a held deploy's card writes out a branch, site or key name that hides its characters, bidi included", async () => {
  const names = await holdNamesOf(
    {
      call: async (cap: string) =>
        cap === "sites.get"
          ? { site: { name: "Da\u202eSH", source: { repo: "a/b", branch: "main\nok" } } }
          : { entries: [{ name: "K", vaultName: "#Key\u2066x", kind: "secret", scope: "production" }] },
    } as never,
    "sites.deploy",
    { siteId: "sit_1" },
  );
  assert.deepEqual(names.site, { name: "Da\\u202eSH", branch: "main\\u000aok", keys: ["Key\\u2066x"], upload: false });
});

test("a held rotation says which site and that GitHub must be given the new secret", () => {
  assert.equal(
    holdShort("sites.webhook_set", { siteId: "s", rotate: true }, { site: { name: "Dash", keys: [] } }),
    "rotate the webhook secret for Dash; GitHub must be given the new one",
  );
});

test("a held read of a web page names the host, then the whole address: never cut, control and bidi characters written out, an address that is not a web address is not worded as a host", () => {
  const url = "https://docs.vendor.example/guide/auth?topic=tokens&page=2";
  assert.equal(wantsFromInput("computers.chrome.read", { url }), `read a web page on docs.vendor.example: ${url}`);
  const long = `https://a.example/${"x".repeat(1982)}?d=THE-END-OF-THE-ADDRESS`;
  assert.ok(long.length > 2000);
  const words = wantsFromInput("computers.chrome.read", { url: long })!;
  assert.ok(words.endsWith(long), "the whole address, to its last character");
  assert.ok(words.includes("THE-END-OF-THE-ADDRESS"));
  const bidi = wantsFromInput("computers.chrome.read", {
    url: "https://a.example/\u202Egpj.exe?x=1\nnewline\u200Bzero",
  })!;
  assert.ok(!/[\u202E\n\u200B]/.test(bidi), "none of them is in the text");
  assert.ok(bidi.includes("[U+202E]") && bidi.includes("[U+000A]") && bidi.includes("[U+200B]"), bidi);
  for (const bad of ["", "not a url", "ftp://x.example/", "javascript:alert(1)", "https://"])
    assert.equal(
      wantsFromInput("computers.chrome.read", { url: bad }),
      "read an address that is not a web address",
      bad,
    );
  assert.equal(HOLD_PHRASES["computers.chrome.read"], "read a web page it chose itself");
});

test("every control and format character is written out on a card: bidi marks, the Arabic letter mark, tag characters, variation selectors, separators", () => {
  const nasty = "https://a.example/p\u061Cq\u2066r\u2069s\u{E0041}t\uFE0Fu\u2028v\u{E0100}w\u00ADx\uE000y";
  const shown = wantsFromInput("computers.chrome.read", { url: nasty })!;
  assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\uFE0F\u{E0100}]/u.test(shown), "none reaches the card as itself");
  for (const code of ["061C", "2066", "2069", "E0041", "FE0F", "2028", "E0100", "00AD", "E000"])
    assert.ok(shown.includes(`[U+${code}]`), code);
  assert.ok(shown.includes("pqrs") === false && shown.includes("p[U+061C]q"), shown);
});

test("a held approval of where a key may be sent always names the host", () => {
  assert.equal(
    holdTitle("automations.key_hosts.allow", { itemId: "vit_1", host: "api.fathom.video" }),
    "Let a key be sent to api.fathom.video",
  );
  assert.equal(
    holdTitle("automations.key_hosts.allow", { itemId: "vit_1", host: "https://www.Example.com/x" }).includes(
      "example.com",
    ),
    true,
  );
  assert.equal(
    holdTitle("automations.key_hosts.remove", { itemId: "vit_1", host: "api.fathom.video" }),
    "Stop a key being sent to api.fathom.video",
  );
  assert.match(holdTitle("automations.key_hosts.allow", {}), /another host/);
  assert.ok(
    holdTitle("automations.key_hosts.allow", { host: "h".repeat(300) + ".com" }).length < 120,
    "a long host is cut",
  );
});

test("a host written with a user name, a port or an address in brackets is read as its host, never the part before the @", () => {
  assert.match(holdTitle("automations.key_hosts.allow", { host: "ok.com@evil.example/x" }), /evil\.example/);
  assert.ok(!holdTitle("automations.key_hosts.allow", { host: "ok.com@evil.example/x" }).includes("ok.com"));
  assert.match(holdTitle("automations.key_hosts.allow", { host: "[::1]:8080" }), /::1|\[::1\]/);
});

test("unassigned code points, lone surrogates and combining marks are written out on a card too, so a path cannot look different from what is read", () => {
  const url = "https://a.example/p\u034Fq\u0378r\uD800s\u20DDt";
  const shown = wantsFromInput("computers.chrome.read", { url })!;
  for (const code of ["034F", "0378", "D800", "20DD"]) assert.ok(shown.includes(`[U+${code}]`), `${code}: ${shown}`);
  assert.ok(!/[\u034F\u0378\uD800\u20DD]/.test(shown), "none reaches the card as itself");
  assert.equal(
    wantsFromInput("computers.chrome.read", { url: "https://a.example/plain/path?x=1&y=%C3%A9" }),
    "read a web page on a.example: https://a.example/plain/path?x=1&y=%C3%A9",
    "ordinary addresses are shown as they are",
  );
});
