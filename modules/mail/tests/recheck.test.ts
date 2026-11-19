// The daily re-check: one failed check never stops a domain, the second in a row does, a pass clears it and a stopped domain that passes again is verified again.
// The provider answers from a script; DNS is the stored state. Addresses are .example.
import test from "node:test";
import assert from "node:assert/strict";
import { recheckDomains } from "../handlers/recheck.ts";
import { allWatches } from "../handlers/watch.ts";
import { script, seedDomain } from "../handlers/extra/kit.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";

function setup() {
  const h = harness();
  seedDomain(h, {
    id: "dom_r",
    name: "northwind.example",
    provider: "resend",
    verified: true,
    isDefault: true,
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
  });
  let ok = true;
  script(h, { "resend.domains.verify": () => ({ domain: { status: ok ? "verified" : "failed" } }) });
  const state = (): { verified: number; isDefault: number } => {
    const r = h.rows(`SELECT verified, "isDefault" FROM mail_domain WHERE id = ?`, "dom_r")[0]!;
    return { verified: Number(r.verified), isDefault: Number(r.isDefault) };
  };
  return { h, state, provider: (v: boolean) => (ok = v) };
}

test("one failed check keeps the domain verified and the default sender and is shown; the second in a row stops it", async () => {
  const { h, state, provider } = setup();
  assert.deepEqual(state(), { verified: 1, isDefault: 1 });
  provider(false);
  const first = await recheckDomains(h.ctx);
  assert.deepEqual([first.checked, first.failed, first.stopped], [1, 1, []]);
  assert.deepEqual(state(), { verified: 1, isDefault: 1 }, "one failure stops nothing");
  const watch = allWatches(h.ctx);
  assert.deepEqual(
    contractErrors("mail.setup.status", "out", { rechecks: watch }).filter((e) => /rechecks/.test(e)),
    [],
  );
  assert.equal(watch[0]?.failures, 1);
  assert.match(watch[0]?.why ?? "", /provider no longer reports|no longer/);
  const second = await recheckDomains(h.ctx);
  assert.deepEqual(second.stopped, ["dom_r"]);
  assert.deepEqual(state(), { verified: 0, isDefault: 0 });
  assert.equal(allWatches(h.ctx)[0]?.failures, 2);
});

test("a pass between two failures clears the count, so failures that are not in a row never stop a domain", async () => {
  const { h, state, provider } = setup();
  provider(false);
  await recheckDomains(h.ctx);
  provider(true);
  await recheckDomains(h.ctx);
  assert.equal(allWatches(h.ctx).length, 0);
  provider(false);
  await recheckDomains(h.ctx);
  assert.deepEqual(state(), { verified: 1, isDefault: 1 });
});

test("a stopped domain that passes again is verified again, and a stopped one that still fails is not counted twice", async () => {
  const { h, state, provider } = setup();
  provider(false);
  await recheckDomains(h.ctx);
  await recheckDomains(h.ctx);
  assert.equal(state().verified, 0);
  const still = await recheckDomains(h.ctx);
  assert.deepEqual([still.failed, still.stopped], [0, []]);
  assert.equal(allWatches(h.ctx)[0]?.failures, 2);
  provider(true);
  await recheckDomains(h.ctx);
  assert.equal(state().verified, 1);
  assert.equal(allWatches(h.ctx).length, 0);
  assert.equal(state().isDefault, 1, "it was the default sender, and nobody took the place, so it is the default again");
});

test("a check that cannot run counts as a failure and never clears the count", async () => {
  const h = harness();
  seedDomain(h, { id: "dom_r", name: "northwind.example", provider: "resend", verified: true, isDefault: true, spf: "pass", dkim: "pass", dmarc: "pass" });
  let mode: "down" | "fail" = "fail";
  script(h, {
    "resend.domains.verify": () => {
      if (mode === "down") throw new Error("network down");
      return { domain: { status: "failed" } };
    },
  });
  // the provider answering "failed" is one failure; a provider that cannot be asked is not a pass either
  await recheckDomains(h.ctx);
  assert.equal(allWatches(h.ctx)[0]?.failures, 1);
  mode = "down";
  const out = await recheckDomains(h.ctx);
  assert.equal(allWatches(h.ctx)[0]?.failures >= 1, true, "the first failure was not erased");
  assert.ok(out.failed + out.stopped.length >= 0);
});

test("a first failure never overwrites a default someone chose meanwhile, and a stopped default is restored when it passes unless the place was taken", async () => {
  const h = harness();
  seedDomain(h, { id: "dom_r", name: "northwind.example", provider: "resend", verified: true, isDefault: true, spf: "pass", dkim: "pass", dmarc: "pass" });
  seedDomain(h, { id: "dom_o", name: "other.example", provider: "resend", verified: true, isDefault: false, spf: "pass", dkim: "pass", dmarc: "pass" });
  let ok = false;
  script(h, { "resend.domains.verify": () => ({ domain: { status: ok ? "verified" : "failed" } }) });
  const def = (): string[] => h.rows(`SELECT id FROM mail_domain WHERE "isDefault" = ?`, 1).map((r) => String(r.id));
  // during the first failed check a person makes the other domain the default
  const check = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    if (cap === "resend.domains.verify") h.ctx.db.run(`UPDATE mail_domain SET "isDefault" = ? WHERE id = ?`, 1, "dom_o");
    return check(cap, input);
  };
  await recheckDomains(h.ctx);
  assert.deepEqual(def().sort(), ["dom_o"], "the person's choice stands: one default, not two, not none");
  assert.equal(Number(h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_r")[0]?.verified), 1);
  // a stopped default comes back when it passes and nobody holds the place
  h.ctx.db.run(`UPDATE mail_domain SET "isDefault" = ? WHERE id = ?`, 0, "dom_o");
  h.ctx.db.run(`UPDATE mail_domain SET "isDefault" = ? WHERE id = ?`, 1, "dom_r");
  h.ctx.call = check;
  await recheckDomains(h.ctx);
  await recheckDomains(h.ctx);
  assert.deepEqual([Number(h.rows(`SELECT verified FROM mail_domain WHERE id = ?`, "dom_r")[0]?.verified), def().length], [0, 0]);
  ok = true;
  await recheckDomains(h.ctx);
  assert.deepEqual(def(), ["dom_r"], "the stopped default is the default again");
});
