// The daily re-check: one failed check never stops a domain, the second in a row does, a pass clears it, a stopped domain that passes again is verified (and the default sender again if the place is free),
// a check that cannot run counts for nothing and is tried again, and a dead mail server fails the check even when DNS passes. The provider answers from a script. Addresses are .example.
import test from "node:test";
import assert from "node:assert/strict";
import { recheckDomains } from "../handlers/recheck.ts";
import { domainCheck } from "../handlers/extra/domains.ts";
import { allWatches } from "../handlers/watch.ts";
import { script, seedDomain } from "../handlers/extra/kit.ts";
import { bindSmtp, setSmtpSecret } from "../handlers/smtp.ts";
import { harness, seedMailbox } from "../fixtures/harness.ts";

const DAY = 24 * 60 * 60_000;
const dom = { verified: true, spf: "pass", dkim: "pass", dmarc: "pass" } as const;

function setup() {
  const h = harness();
  seedDomain(h, { id: "dom_r", name: "northwind.example", provider: "resend", isDefault: true, ...dom });
  let ok = true;
  script(h, { "resend.domains.verify": () => ({ domain: { status: ok ? "verified" : "failed" } }) });
  const state = (id = "dom_r"): { verified: number; isDefault: number } => {
    const r = h.rows(`SELECT verified, "isDefault" FROM mail_domain WHERE id = ?`, id)[0]!;
    return { verified: Number(r.verified), isDefault: Number(r.isDefault) };
  };
  const run = async () => {
    h.advance(DAY);
    return recheckDomains(h.ctx);
  };
  return { h, state, provider: (v: boolean) => (ok = v), run };
}

test("one failed check keeps the domain verified and the default sender and is shown; the second in a row stops it", async () => {
  const { h, state, provider, run } = setup();
  provider(false);
  const first = await run();
  assert.deepEqual([first.checked, first.failed, first.stopped], [1, 1, []]);
  assert.deepEqual(state(), { verified: 1, isDefault: 1 }, "one failure stops nothing");
  const watch = allWatches(h.ctx);
  assert.equal(watch[0]?.failures, 1);
  assert.match(watch[0]?.why ?? "", /no longer/);
  const second = await run();
  assert.deepEqual(second.stopped, ["dom_r"]);
  assert.deepEqual(state(), { verified: 0, isDefault: 0 });
  assert.equal(allWatches(h.ctx)[0]?.failures, 2);
});

test("a domain looked at within the day is not looked at again, so one bad hour cannot count twice", async () => {
  const { h, state, provider } = setup();
  provider(false);
  h.advance(DAY);
  await recheckDomains(h.ctx);
  const again = await recheckDomains(h.ctx);
  assert.deepEqual([again.checked, again.skipped], [0, 1]);
  assert.equal(allWatches(h.ctx)[0]?.failures, 1);
  assert.equal(state().verified, 1);
});

test("a pass between two failures clears the count, so failures that are not in a row never stop a domain", async () => {
  const { h, state, provider, run } = setup();
  provider(false);
  await run();
  provider(true);
  await run();
  assert.equal(allWatches(h.ctx).length, 0);
  provider(false);
  await run();
  assert.deepEqual(state(), { verified: 1, isDefault: 1 });
});

test("a stopped domain that passes again is verified again and the default sender again, and a stopped one that still fails is not counted twice", async () => {
  const { h, state, provider, run } = setup();
  provider(false);
  await run();
  await run();
  assert.equal(state().verified, 0);
  const still = await run();
  assert.deepEqual([still.failed, still.stopped], [0, []]);
  assert.equal(allWatches(h.ctx)[0]?.failures, 2);
  provider(true);
  await run();
  assert.deepEqual(state(), { verified: 1, isDefault: 1 });
  assert.equal(allWatches(h.ctx).length, 0);
});

test("a check that cannot run is unknown: no pass, no failure, strikes stay as they were, and the next run tries again", async () => {
  const h = harness();
  seedDomain(h, { id: "dom_r", name: "northwind.example", provider: "resend", isDefault: true, ...dom });
  let mode: "down" | "fail" | "ok" = "fail";
  script(h, {
    "resend.domains.verify": () => {
      if (mode === "down") throw new Error("network down");
      return { domain: { status: mode === "ok" ? "verified" : "failed" } };
    },
  });
  const run = async () => (h.advance(DAY), recheckDomains(h.ctx));
  await run(); // one real failure
  assert.equal(allWatches(h.ctx)[0]?.failures, 1);
  // the provider cannot be asked: domainCheck keeps what it knew and still finishes, so a thrown check is simulated at the database
  const realRun = h.ctx.db.run.bind(h.ctx.db);
  h.ctx.db.run = (sql: string, ...args: unknown[]) => {
    if (/^\s*UPDATE mail_domain SET .*checkedAt/i.test(sql)) throw new Error("the check could not be saved");
    return realRun(sql, ...args);
  };
  mode = "ok";
  const out = await run();
  assert.deepEqual([out.unknown, out.failed, out.stopped], [["dom_r"], 0, []]);
  assert.equal(
    allWatches(h.ctx)[0]?.failures,
    1,
    "an unknown check neither clears the first failure nor adds a second",
  );
  assert.equal(Number(h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_r")[0]?.verified), 1);
  // and the very next run (an hour later is enough: nothing was recorded as checked) tries it again
  h.ctx.db.run = realRun;
  h.advance(60 * 60_000);
  const next = await recheckDomains(h.ctx);
  assert.equal(next.checked, 1);
  assert.equal(allWatches(h.ctx).length, 0, "it passed, so the count is cleared");
});

test("a first failure never overwrites a default someone chose meanwhile, and a stopped default is restored when it passes unless the place was taken", async () => {
  const h = harness();
  seedDomain(h, { id: "dom_r", name: "northwind.example", provider: "resend", isDefault: true, ...dom });
  seedDomain(h, { id: "dom_o", name: "other.example", provider: "resend", isDefault: false, ...dom });
  let ok = false;
  script(h, { "resend.domains.verify": () => ({ domain: { status: ok ? "verified" : "failed" } }) });
  const def = (): string[] => h.rows(`SELECT id FROM mail_domain WHERE "isDefault" = ?`, 1).map((r) => String(r.id));
  const check = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    if (cap === "resend.domains.verify")
      h.ctx.db.run(`UPDATE mail_domain SET "isDefault" = ? WHERE id = ?`, 1, "dom_o");
    return check(cap, input);
  };
  h.advance(DAY);
  await recheckDomains(h.ctx);
  assert.deepEqual(def().sort(), ["dom_o"], "the person's choice stands: one default, not two, not none");
  assert.equal(Number(h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_r")[0]?.verified), 1);
  h.ctx.db.run(`UPDATE mail_domain SET "isDefault" = ? WHERE id = ?`, 0, "dom_o");
  h.ctx.db.run(`UPDATE mail_domain SET "isDefault" = ? WHERE id = ?`, 1, "dom_r");
  h.ctx.call = check;
  h.advance(DAY);
  await recheckDomains(h.ctx);
  assert.deepEqual(
    [Number(h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_r")[0]?.verified), def().length],
    [0, 0],
  );
  ok = true;
  h.advance(DAY);
  await recheckDomains(h.ctx);
  assert.deepEqual(def(), ["dom_r"], "the stopped default is the default again");
});

test("a dead mail server fails the check even when DNS passes, and counts against the domain that sends through it", async () => {
  const h = harness();
  setSmtpSecret(async () => "pw");
  h.ctx.call = ((base) => async (cap: string, input: unknown) =>
    cap === "vault.items.list" ? { items: [{ handle: "#Smtp_Password" }] } : base(cap, input))(h.ctx.call.bind(h.ctx));
  let up = false;
  bindSmtp(h.ctx, {
    verify: async () => {
      if (!up) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    },
    send: async () => ({ rejected: [] }),
  });
  const { smtpSet } = await import("../handlers/smtp.ts");
  await smtpSet(h.ctx, {
    host: "smtp.northwind.example",
    port: 587,
    username: "hello@northwind.example",
    passwordHandle: "#Smtp_Password",
  });
  seedDomain(h, { id: "dom_s", name: "northwind.example", provider: "smtp", isDefault: true, ...dom });
  seedMailbox(h, "mbx_s", "hello@northwind.example", { kind: "shared" });
  h.ctx.db.run(`UPDATE mail_smtp SET state = ? WHERE id = ?`, "ok", "space"); // it was fine yesterday
  h.advance(DAY);
  const out = await recheckDomains(h.ctx);
  assert.deepEqual([out.failed, out.stopped], [1, []]);
  const w = allWatches(h.ctx)[0];
  assert.deepEqual([w?.domainId, w?.failures], ["dom_s", 1]);
  assert.match(w?.why ?? "", /mail server/);
  assert.equal(
    Number(h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_s")[0]?.verified),
    1,
    "one failure only warns",
  );
  h.advance(DAY);
  assert.deepEqual((await recheckDomains(h.ctx)).stopped, ["dom_s"]);
  setSmtpSecret(null);
});

test("a server test that cannot run (the Vault is unavailable) says nothing about the server: SMTP domains are left alone, not struck", async () => {
  const h = harness();
  setSmtpSecret(async () => "pw");
  h.ctx.call = ((base) => async (cap: string, input: unknown) =>
    cap === "vault.items.list" ? { items: [{ handle: "#Smtp_Password" }] } : base(cap, input))(h.ctx.call.bind(h.ctx));
  bindSmtp(h.ctx, { verify: async () => undefined, send: async () => ({ rejected: [] }) });
  const { smtpSet } = await import("../handlers/smtp.ts");
  await smtpSet(h.ctx, {
    host: "smtp.northwind.example",
    port: 587,
    username: "hello@northwind.example",
    passwordHandle: "#Smtp_Password",
  });
  seedDomain(h, { id: "dom_s", name: "northwind.example", provider: "smtp", isDefault: true, ...dom });
  h.ctx.db.run(`UPDATE mail_smtp SET state = ? WHERE id = ?`, "ok", "space");
  setSmtpSecret(null); // the Vault is gone: the test throws instead of answering
  for (let i = 0; i < 3; i++) {
    h.advance(DAY);
    const out = await recheckDomains(h.ctx);
    assert.deepEqual([out.unknown, out.failed, out.stopped], [["dom_s"], 0, []]);
  }
  assert.equal(allWatches(h.ctx).length, 0, "no strike for a test that never ran");
  assert.deepEqual(
    [
      Number(h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_s")[0]?.verified),
      Number(h.rows(`SELECT "isDefault" FROM mail_domain WHERE id = ?`, "dom_s")[0]?.isDefault),
    ],
    [1, 1],
  );
});

test("a stopped domain that a person verifies by hand carries no hidden count: its default place comes back, and the next single failure only warns", async () => {
  const h = harness();
  seedDomain(h, { id: "dom_r", name: "northwind.example", provider: "resend", isDefault: true, ...dom });
  let ok = false;
  script(h, { "resend.domains.verify": () => ({ domain: { status: ok ? "verified" : "failed" } }) });
  const row = () => h.rows(`SELECT verified, "isDefault" FROM mail_domain WHERE id = ?`, "dom_r")[0]!;
  for (let i = 0; i < 2; i++) {
    h.advance(DAY);
    await recheckDomains(h.ctx);
  }
  assert.deepEqual([Number(row().verified), Number(row().isDefault)], [0, 0]);
  assert.equal(allWatches(h.ctx)[0]?.failures, 2);
  // a person presses Check DNS and it passes
  ok = true;
  await domainCheck(h.ctx, { domainId: "dom_r" });
  assert.deepEqual([Number(row().verified), Number(row().isDefault)], [1, 1], "verified and the default sender again");
  assert.equal(allWatches(h.ctx).length, 0, "no hidden count of 2 is left behind");
  // the next failure is the first in a row: a warning, not a stop
  ok = false;
  h.advance(DAY);
  await recheckDomains(h.ctx);
  assert.deepEqual([Number(row().verified), Number(row().isDefault)], [1, 1]);
  assert.equal(allWatches(h.ctx)[0]?.failures, 1);
});
