// The pull obeys an app's limit: a spec's calls-a-minute budget holds for every object of a connection together, an app that says slow down is waited for (what Retry-After says, or 30 s doubling),
// nothing is lost or doubled, and the Sync page says so in plain words. Also: a field only some records fill is a warning, and a spec sets how often an object is read whole.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ledgerSpec } from "../fixtures/crm.ts";
import { world } from "../fixtures/crm-world.ts";
import { SYNC_PASS_TOKEN } from "../projections.ts";
import { consumers } from "../impl.ts";
import { remoteStore } from "../../../host/src/daemon/syncengine.ts";
import { compileSpec, parseSpec, rateOf } from "../syncspec.ts";
import type { SyncSpec } from "../syncspec.ts";

const SOURCES_SQL = readFileSync(new URL("../../sources/migrations/0001_sources.sql", import.meta.url), "utf8");
type World = ReturnType<typeof world>;
const mutate = (spec: Record<string, any>, fn: (s: Record<string, any>) => void): Record<string, any> => {
  const s = JSON.parse(JSON.stringify(spec));
  fn(s);
  return s;
};

/** An app that counts what reaches it. `rule` decides, per request, whether to answer 429 and with what Retry-After. */
function standIn(w: World, rule: (now: number, seen: number[]) => { retryAfter?: string } | undefined) {
  const orgs = Array.from({ length: 35 }, (_, i) => ({
    id: `o${i}`,
    name: `Org ${i}`,
    modified: "2026-10-01T10:00:00Z",
  }));
  const people = Array.from({ length: 7 }, (_, i) => ({
    id: 100 + i,
    attributes: { full_name: `Person ${i}`, email: `p${i}@example.test`, status: "lead" },
    org_id: "o1",
    modified: "2026-10-01T10:00:00Z",
  }));
  const seen: number[] = [];
  const refused: number[] = [];
  w.k.state.reply = (req) => {
    const now = w.k.clock.t;
    seen.push(now);
    const no = rule(
      now,
      seen.slice(0, -1).filter((t) => !refused.includes(t)),
    );
    if (no) {
      refused.push(now);
      return { status: 429, ...(no.retryAfter ? { retryAfter: no.retryAfter } : {}) };
    }
    const url = new URL(req.url);
    const n = Number(url.searchParams.get("page") ?? "1");
    const per = Number(url.searchParams.get("per_page") ?? "10");
    const all = url.pathname.endsWith("/people") ? people : orgs;
    return { status: 200, body: { data: all.slice((n - 1) * per, n * per) } };
  };
  return { seen, refused };
}

async function applied(requestsPerMinute?: number) {
  const w = world();
  w.k.tx.exec(SOURCES_SQL);
  const spec = mutate(ledgerSpec(), (s) => {
    if (requestsPerMinute !== undefined) s["plan"]["requestsPerMinute"] = requestsPerMinute;
  });
  const out = await w.k.hs["sync_specs.apply"](w.ctx, { spec, idempotencyKey: "r1" });
  const objects = (await w.k.hs["connectors.get"](w.ctx, { key: out.connector })).connector.objects;
  const slept: number[] = [];
  const slows: number[] = [];
  const ctx = { call: (cap: string, input: unknown) => (w.k.hs as any)[cap](w.ctx, input) };
  const store = (remote: string) =>
    remoteStore(ctx as any, { connector: out.connector, connectionId: out.connectionId, remote }, objects, {
      sleep: async (ms) => {
        slept.push(ms);
        w.k.clock.t += ms;
      },
      onSlow: (ms) => slows.push(ms),
      unmaskToken: SYNC_PASS_TOKEN,
      nonce: "pass1",
    });
  return { w, out, store, slept, slows, call: ctx.call };
}
/** Pull both objects a page at a time, alternating, until each has said it is done. */
async function pullBoth(store: (r: string) => ReturnType<typeof remoteStore>) {
  const o = store("organizations"),
    p = store("people");
  const got: Record<string, string[]> = { organizations: [], people: [] };
  const next: Record<string, string | undefined> = { organizations: undefined, people: undefined };
  const done: Record<string, boolean> = { organizations: false, people: false };
  while (!done["organizations"] || !done["people"])
    for (const [name, s] of [
      ["organizations", o],
      ["people", p],
    ] as const) {
      if (done[name]) continue;
      const page = await s.page(next[name]);
      got[name]!.push(...page.rows.map((r) => r.id));
      next[name] = page.next;
      if (page.next === undefined) done[name] = true;
    }
  return got;
}
const busiest = (stamps: number[], windowMs = 60_000): number =>
  Math.max(0, ...stamps.map((t) => stamps.filter((u) => u >= t && u < t + windowMs).length));

test("a spec's calls a minute become the connection's budget; no setting keeps today's", () => {
  assert.deepEqual(rateOf(parseSpec(ledgerSpec()).spec as SyncSpec), { rps: 5, burst: 10 });
  const spec = parseSpec(mutate(ledgerSpec(), (s) => (s["plan"]["requestsPerMinute"] = 30))).spec as SyncSpec;
  assert.deepEqual(rateOf(spec), { rps: 0.5, burst: 1 });
  assert.deepEqual(compileSpec(spec).connector.rate, { rps: 0.5, burst: 1 });
  for (const bad of [0, -3, "fast", 100_000])
    assert.match(
      parseSpec(mutate(ledgerSpec(), (s) => (s["plan"]["requestsPerMinute"] = bad)))
        .problems.map((p) => p.message)
        .join(" "),
      /requestsPerMinute/,
    );
});

test("the budget holds across every object of the connection, and the pull finishes with nothing lost or doubled", async () => {
  const a = await applied(30);
  const app = standIn(a.w, (now, seen) =>
    seen.filter((t) => t > now - 60_000).length >= 30 ? { retryAfter: "5" } : undefined,
  );
  const got = await pullBoth(a.store);
  assert.equal(app.refused.length, 0, "the app never had to say slow down");
  assert.ok(app.seen.length >= 8, "both objects were read");
  assert.ok(busiest(app.seen) <= 30, `no minute holds more than 30 calls (most: ${busiest(app.seen)})`);
  assert.deepEqual(got["organizations"]!.length, 35);
  assert.equal(new Set(got["organizations"]).size, 35);
  assert.equal(new Set(got["people"]).size, 7);
});

test("a 429 with Retry-After in seconds is waited for exactly, by every object, and the pull goes on", async () => {
  const a = await applied();
  // the app lets 3 calls in a minute and says when the oldest leaves the window
  const app = standIn(a.w, (now, seen) => {
    const inWindow = seen.filter((t) => t > now - 60_000);
    return inWindow.length >= 3 ? { retryAfter: String(Math.ceil((inWindow[0]! + 60_000 - now) / 1000)) } : undefined;
  });
  const got = await pullBoth(a.store);
  assert.ok(app.refused.length >= 1, "the app did say slow down");
  assert.ok(a.slows.length >= 1 && a.slows.every((ms) => ms >= 1000), "the engine waited for what it was told");
  assert.equal(new Set(got["organizations"]).size, 35);
  assert.equal(new Set(got["people"]).size, 7);
  assert.equal(got["organizations"]!.length, 35, "nothing doubled");
  // after every refusal the connection sends nothing until the app's own time
  for (const t of app.refused) {
    const after = app.seen.filter((u) => u > t)[0];
    if (after !== undefined) assert.ok(after - t >= 1000, "no call right behind a refusal");
  }
  // a refusal caused no second one: the people calls waited too (one hold, not one per object)
  assert.ok(app.refused.length <= 3, `refusals: ${app.refused.length}`);
});

test("Retry-After as an HTTP date is read", async () => {
  const a = await applied();
  let first = true;
  let until = 0;
  const app = standIn(a.w, (now) => {
    if (first) {
      first = false;
      until = Math.ceil((now + 45_000) / 1000) * 1000;
      return { retryAfter: new Date(until).toUTCString() };
    }
    return undefined;
  });
  const o = a.store("organizations");
  const page = await o.page();
  assert.equal(page.rows.length, 10);
  assert.equal(app.refused.length, 1);
  assert.ok(app.seen[1]! >= until, "the next call went after the date the app named");
  assert.ok(a.slows[0]! >= 44_000 && a.slows[0]! <= 46_000, `waited ${a.slows[0]}`);
});

test("a 429 with no Retry-After backs off from 30 s, doubling, and starts again after an answer", async () => {
  const a = await applied();
  let refusals = 4;
  standIn(a.w, () => (refusals-- > 0 ? {} : undefined));
  const o = a.store("organizations");
  await o.page();
  assert.deepEqual(a.slows, [30_000, 60_000, 120_000, 240_000]);
  refusals = 2;
  await o.page("2");
  assert.deepEqual(a.slows.slice(4), [30_000, 60_000], "an answer in between starts the doubling again");
});

test("an app that keeps saying slow down ends the pass after a sensible number of waits, and the error says so", async () => {
  const a = await applied();
  const app = standIn(a.w, () => ({}));
  await assert.rejects(a.store("organizations").page(), (e: any) => e.error?.code === "provider.rate_limited");
  assert.equal(a.slows.length, 8);
  assert.deepEqual(a.slows, [30_000, 60_000, 120_000, 240_000, 480_000, 480_000, 480_000, 480_000]);
  assert.equal(app.seen.length, 9, "a call after each wait, never faster");
});

test("while one object is held, another object of the connection is not sent to the app at all", async () => {
  const a = await applied();
  let first = true;
  const app = standIn(a.w, () => {
    if (!first) return undefined;
    first = false;
    return { retryAfter: "20" };
  });
  await assert.rejects(
    a.call("connectors.read", {
      key: a.out.connector,
      action: "list_organizations",
      connectionId: a.out.connectionId,
      input: {},
    }),
  );
  const before = app.seen.length;
  await assert.rejects(
    a.call("connectors.read", {
      key: a.out.connector,
      action: "list_people",
      connectionId: a.out.connectionId,
      input: {},
    }),
    (e: any) => e.error?.code === "rate_limit.exceeded" && e.error?.details?.retryAfterMs > 15_000,
  );
  assert.equal(app.seen.length, before, "nothing reached the app while the connection was held");
});

test("the Sync page says the app asked Vyre to slow down, and when the pull goes on", async () => {
  const a = await applied();
  const { w } = a;
  w.k.tx.exec(
    "CREATE TABLE IF NOT EXISTS sy_slow (sync_type TEXT PRIMARY KEY, since INTEGER NOT NULL, resume_at INTEGER NOT NULL)",
  );
  const row = w.k.tx.get<{ sync_type_id: string }>("SELECT sync_type_id FROM cn_synced_types WHERE type = 'org'")!;
  w.k.tx.run("INSERT INTO sy_slow VALUES (?, ?, ?)", row.sync_type_id, w.k.clock.t, w.k.clock.t + 90_000);
  const status = await w.k.hs["sync_types.status"](w.ctx, { type: "org" });
  assert.match(status.slowedDown!.words, /^The app asked Vyre to slow down\. The pull goes on in about 2 minutes\.$/);
  assert.equal(status.slowedDown!.resumesAt, w.k.clock.t + 90_000);
  w.k.clock.t += 91_000;
  assert.equal((await w.k.hs["sync_types.status"](w.ctx, { type: "org" })).slowedDown, undefined);
});

test("a field the object declares but no sampled record fills is a warning; the record has no value until the app sends one", async () => {
  const w = world();
  const spec = mutate(ledgerSpec(), (s) => {
    s["objects"][1]["fields"].push({ path: "/attributes/custom_7", label: "Seven", type: "text" });
    s["mapping"][1]["fields"].push({ path: "/attributes/custom_7", field: "seven", direction: "pull" });
  });
  const v = await w.k.hs["sync_specs.validate"](w.ctx, { spec });
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.ok(
    v.problems.some(
      (p) =>
        p.level === "warn" &&
        /custom_7 is empty on the \d+ records looked at; it will fill in where the app has a value\./.test(p.message),
    ),
  );
  const out = await w.k.hs["sync_specs.apply"](w.ctx, { spec, idempotencyKey: "sparse" });
  assert.ok(out.types.some((t) => t.type === "person"));
  // a record where the path shows up later maps to a value; one without it maps to none
  const compiled = compileSpec(parseSpec(spec).spec as SyncSpec);
  const person = compiled.types.find((t) => t.recordType === "person")!;
  assert.ok(person.fields.some((f) => f.remote === "/attributes/custom_7" && f.key === "seven"));
  assert.ok(person.defs.some((d) => d.key === "seven"));
});

test("a spec sets how often an object is read whole; without it the first schedule is as before", async () => {
  const w = world();
  w.k.tx.exec(SOURCES_SQL);
  const spec = mutate(ledgerSpec(), (s) => {
    s["objects"][0]["list"]["checkEveryMinutes"] = 360;
  });
  await w.k.hs["sync_specs.apply"](w.ctx, { spec, idempotencyKey: "every" });
  const org = (await w.k.hs["sync_types.get"](w.ctx, { type: "org" })).syncedType;
  assert.deepEqual(org.polling, { activeSec: 21_600, idleSec: 21_600, dormantSec: 21_600 });
  const person = (await w.k.hs["sync_types.get"](w.ctx, { type: "person" })).syncedType;
  assert.deepEqual(
    person.polling,
    { activeSec: 900, idleSec: 3600, dormantSec: 14_400 },
    "an object with no setting keeps the schedule it had",
  );
  assert.match(
    parseSpec(mutate(ledgerSpec(), (s) => (s["objects"][0]["list"]["checkEveryMinutes"] = 0)))
      .problems.map((p) => p.message)
      .join(" "),
    /checkEveryMinutes/,
  );
});

test("a call at the connection's budget waits in line: the pull finishes, the app never says slow down and no call is refused", async () => {
  const a = await applied(30);
  (a.w.k.deps as { pace?: (ms: number) => Promise<void> }).pace = async (ms) => {
    a.w.k.clock.t += ms;
  };
  const refused: string[] = [];
  const read = (a.w.k.hs as any)["connectors.read"];
  (a.w.k.hs as any)["connectors.read"] = async (c: unknown, i: unknown) => {
    try {
      return await read(c, i);
    } catch (e: any) {
      refused.push(e?.error?.code);
      throw e;
    }
  };
  const app = standIn(a.w, (now, seen) => (seen.filter((t) => t > now - 60_000).length >= 30 ? {} : undefined));
  const got = await pullBoth(a.store);
  assert.equal(app.refused.length, 0, "the app never had to say slow down");
  assert.deepEqual(refused, [], "no call came back refused: each waited for its turn");
  assert.equal(new Set(got["organizations"]).size, 35);
  assert.equal(new Set(got["people"]).size, 7);
  assert.ok(busiest(app.seen) <= 30);
});

test("a pass reads the connection's key from the Vault once, not once per request; a key the app rejects is read again", async () => {
  const a = await applied();
  let reads = 0;
  const deps = a.w.k.deps as { resolveSecret?: (h: string, b?: unknown) => Promise<string | undefined> };
  const real = deps.resolveSecret!;
  deps.resolveSecret = async (h, b) => {
    reads++;
    return real(h, b);
  };
  const app = standIn(a.w, () => undefined);
  await pullBoth(a.store);
  assert.ok(app.seen.length >= 8, "a pass of several requests");
  assert.ok(reads <= 4, `the Vault was read ${reads} times for ${app.seen.length} requests`);
  // the key is changed in the app: the first answer is a rejection, the key is read again and sent once more
  const before = reads;
  a.w.k.clock.t += 1000;
  let rejected = 1;
  a.w.k.state.reply = () => (rejected-- > 0 ? { status: 401, body: {} } : { status: 200, body: { data: [] } });
  await a.store("organizations").page();
  assert.ok(reads > before, "after a rejection the key was read from the Vault again");
});

test("a Vault or access change ends what a pass kept at once: the next request asks the Vault again, and a key used now is not the old one", async () => {
  const a = await applied();
  let reads = 0;
  const deps = a.w.k.deps as { resolveSecret?: (h: string, b?: unknown) => Promise<string | undefined> };
  const real = deps.resolveSecret!;
  deps.resolveSecret = async (h, b) => {
    reads++;
    return real(h, b);
  };
  standIn(a.w, () => undefined);
  const o = a.store("organizations");
  await o.page();
  const warm = reads;
  await o.page("2");
  assert.equal(reads, warm, "kept: the second page asked the Vault for nothing");
  for (const event of consumers["connectors.forget_pass_keys"].on) {
    await o.page();
    const before = reads;
    consumers["connectors.forget_pass_keys"].run();
    await o.page("2");
    assert.ok(reads > before, `after ${event}-class change the Vault was asked again`);
    await o.page("3");
  }
  // the key is rotated in the Vault: the request after the event sends the new one
  const sent: string[] = [];
  const reply = a.w.k.state.reply;
  a.w.k.state.reply = (req) => {
    sent.push(JSON.stringify(req.headers));
    return reply(req);
  };
  const vault = a.w.k.vault as Record<string, string>;
  const handle = "#Ledger_Key";
  const old = vault[handle];
  vault[handle] = "rotated-value-777";
  consumers["connectors.forget_pass_keys"].run();
  await o.page("4");
  assert.ok(
    sent.some((h) => h.includes("rotated-value-777")),
    "the rotated key went out, not the kept one",
  );
  vault[handle] = old!;
});

test("a call waits in line for the budget at most 30 s altogether, then fails with the wait it still needs", async () => {
  const a = await applied(15);
  const paced: number[] = [];
  (a.w.k.deps as { pace?: (ms: number) => Promise<void> }).pace = async (ms) => {
    paced.push(ms); // the clock does not move: the budget never refills
  };
  standIn(a.w, () => undefined);
  const read = () =>
    a.call("connectors.read", {
      key: a.out.connector,
      action: "list_organizations",
      connectionId: a.out.connectionId,
      input: {},
    });
  await read();
  await assert.rejects(
    read(),
    (e: any) => e.error?.code === "rate_limit.exceeded" && e.error?.details?.retryAfterMs > 0,
  );
  assert.ok(paced.length > 0, "it did wait in line first");
  assert.ok(paced.reduce((x, y) => x + y, 0) <= 30_000, `waited ${paced.reduce((x, y) => x + y, 0)} ms in all`);
});

test("a kept key is checked again for every call: a share taken away mid-pass stops the very next call", async () => {
  const a = await applied();
  const deps = a.w.k.deps as {
    recheckSecret?: (h: string, b: unknown) => Promise<boolean | void>;
  };
  let allowed = true;
  let rechecks = 0;
  deps.recheckSecret = async () => {
    rechecks++;
    if (!allowed)
      throw { error: { code: "permission.no_grant", message: "Vault access changed before this connector request." } };
  };
  const app = standIn(a.w, () => undefined);
  const o = a.store("organizations");
  await o.page();
  await o.page("2");
  assert.ok(rechecks >= 1, "the second page checked access again");
  const sent = app.seen.length;
  allowed = false; // the Vault item's share is removed, mid-pass
  await assert.rejects(o.page("3"), (e: any) => e.error?.code === "permission.no_grant");
  assert.equal(app.seen.length, sent, "nothing went to the app after the share was removed");
  // a host that cannot tell (false) reads the key again
  allowed = true;
  let reads = 0;
  const d2 = a.w.k.deps as { resolveSecret?: (h: string, b?: unknown) => Promise<string | undefined> };
  const real = d2.resolveSecret!;
  d2.resolveSecret = async (h, b) => {
    reads++;
    return real(h, b);
  };
  deps.recheckSecret = async () => false;
  await o.page("2");
  const r1 = reads;
  await o.page("3");
  assert.ok(reads > r1, "no kept key was used when the host could not vouch for it");
});
