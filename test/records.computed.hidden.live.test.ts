// The hidden rule for computed values (formula, lookup, rollup): a person gets a computed value only when they may read EVERYTHING it was computed from: each field it reads on the record, and for a lookup or a rollup
// the field on EVERY linked record, each of those records visible to them. One input hidden, one link unseen, and the value is simply not there (like a hidden field): never a smaller sum, never an error that names the
// input. Every probe has an owner control (the owner has the value) and a member control (a member who may read every input has it). Real server-role daemon, real access and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("computedhidden");
});
after(async () => {
  await h?.stop();
});

let seq = 0;
/** The Space limits how many people accept an invite a minute: a test that makes many waits and tries again. */
const joined = async (n: Person, code: string): Promise<void> => {
  for (let tries = 0; ; tries++) {
    try {
      await join(h, n, code, { device: "web" });
      return;
    } catch (e) {
      if (tries >= 8 || !/rate_limit/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 8_000));
    }
  }
};
const newMember = async (tag: string): Promise<Person> => {
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `${tag}@firm.test`,
  });
  const n = h.person(`Computed ${tag}`, tag, `${tag}@firm.test`, `${tag} horse battery staple 9`);
  await joined(n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!));
  return n;
};
const grant = async (rid: string, n: Person, hide: string[] | undefined, key: string): Promise<void> => {
  const ref = { type: "record", id: rid };
  await h.owner.call("access.audience_set", { resource: ref, audience: "added" });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: n.personId },
    level: "view",
    ...(hide ? { conditions: { hiddenFields: hide } } : {}),
    idempotencyKey: key,
  });
};
const fieldsOf = async (
  who: Pick<Person, "attempt">,
  type: string,
  id: string,
): Promise<Record<string, unknown> | null> => {
  const r = await who.attempt("records.get", { type, recordId: id });
  return r.ok ? ((r.data as { record: { fields: Record<string, unknown> } }).record.fields ?? {}) : null;
};
const until = async (ok: () => Promise<boolean>, ms = 60_000): Promise<void> => {
  const end = Date.now() + ms;
  for (;;) {
    await h.d.hooks?.pump?.();
    if (await ok()) return;
    if (Date.now() > end) throw new Error("the consumer never got there");
    await new Promise((r) => setTimeout(r, 100));
  }
};
const own = h as unknown as { owner: Person };

test("a formula over a field the grant hides is not there for that person, and is there for the owner and for a person who may read every input", async () => {
  const tag = `fh${++seq}`;
  const type = `ledg${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Line",
          plural: "Lines",
          icon: "table",
          titleField: "name",
          fields: ["name", "qty", "price"].map((key) => ({
            key,
            type: key === "name" ? "text" : "number",
            title: key,
          })),
        },
      },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-f`,
    ops: [
      {
        op: "field.add",
        type,
        field: "total",
        def: { type: "formula", title: "Total", options: { expr: "qty * price" } },
      },
    ],
  });
  const r = (await h.owner.call("records.create", { type, fields: { name: `Row ${tag}`, qty: 3, price: 7001 } })) as {
    record: { id: string };
  };
  const id = r.record.id;
  const blind = await newMember(`blind${tag}`);
  const sighted = await newMember(`sighted${tag}`);
  await grant(id, blind, ["price"], `${tag}-g1`);
  await grant(id, sighted, undefined, `${tag}-g2`);
  await until(async () => (await fieldsOf(h.owner, type, id))?.["total"] === 21003);
  // controls
  assert.equal((await fieldsOf(h.owner, type, id))?.["total"], 21003, "the owner has the total");
  assert.equal(
    (await fieldsOf(sighted, type, id))?.["total"],
    21003,
    "a person who may read qty and price has the total",
  );
  // the probe: price is hidden, so the total is not there, and neither are fragments of it
  const seen = await fieldsOf(blind, type, id);
  assert.ok(
    seen && seen["name"] === `Row ${tag}` && seen["qty"] === 3,
    "the person sees the record and the field they may read",
  );
  assert.equal("total" in (seen ?? {}), false, "no total for a person who cannot read price");
  assert.equal("price" in (seen ?? {}), false);
  const list = JSON.stringify((await blind.attempt("records.query", { type, limit: 100 })).data ?? null);
  for (const frag of ["21003", "7001", "total"])
    assert.equal(list.includes(frag), false, `records.query for the blind person carries "${frag}"`);
  // swap: the owner changes the hidden price; what the blind person sees is identical
  const before = JSON.stringify(await fieldsOf(blind, type, id));
  await h.owner.call("records.update", { type, recordId: id, patch: { price: 8002 } });
  await until(async () => (await fieldsOf(h.owner, type, id))?.["total"] === 24006);
  assert.equal(
    JSON.stringify(await fieldsOf(blind, type, id)),
    before,
    "the owner's change to the hidden price changes nothing the person sees",
  );
  assert.equal(
    (await fieldsOf(sighted, type, id))?.["total"],
    24006,
    "control: the person who may read it follows the change",
  );
  void own;
});

test("a lookup and a rollup are there only when every linked record and its field may be read, and a link the person cannot see makes the rollup empty, not smaller", async () => {
  const tag = `lr${++seq}`;
  const a = `acc${tag}`;
  const i = `invo${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type: a,
        def: {
          title: "Account",
          plural: "Accounts",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
      {
        op: "type.create",
        type: i,
        def: {
          title: "Invoice",
          plural: "Invoices",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "name" },
            { key: "amount", type: "number", title: "amount" },
          ],
        },
      },
      { op: "relation.add", type: i, field: "account", def: { to: a, inverse: "invoices" } },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-c`,
    ops: [
      {
        op: "field.add",
        type: i,
        field: "account_name",
        def: { type: "lookup", title: "Account name", options: { via: "account", field: "name" } },
      },
      {
        op: "field.add",
        type: a,
        field: "billed",
        def: { type: "rollup", title: "Billed", options: { via: "invoices", field: "amount", fn: "sum" } },
      },
      {
        op: "field.add",
        type: a,
        field: "billed_k",
        def: { type: "formula", title: "Billed k", options: { expr: "billed / 1000" } },
      },
    ],
  });
  const acc = (
    (await h.owner.call("records.create", { type: a, fields: { name: `Acme ${tag}` } })) as { record: { id: string } }
  ).record.id;
  const mk = async (name: string, amount: number): Promise<string> => {
    const r = (await h.owner.call("records.create", { type: i, fields: { name, amount } })) as {
      record: { id: string };
    };
    await h.owner.call("records.relate", { type: i, recordId: r.record.id, field: "account", toId: acc });
    return r.record.id;
  };
  const i1 = await mk(`I1 ${tag}`, 1000);
  const i2 = await mk(`I2 ${tag}`, 2000);
  const i3 = await mk(`I3 ${tag}`, 4000);
  const m = await newMember(`lr${tag}`);
  // the person sees the account and the first two invoices; the third is only for people added, and they are not
  await grant(i3, await newMember(`other${tag}`), undefined, `${tag}-other`);
  await until(async () => (await fieldsOf(h.owner, a, acc))?.["billed"] === 7000);
  assert.equal(
    (await fieldsOf(h.owner, a, acc))?.["billed_k"],
    7,
    "control: the owner has the rollup and the formula over it",
  );
  const seesRollup = async (): Promise<unknown> => (await fieldsOf(m, a, acc))?.["billed"];
  assert.notEqual(await fieldsOf(m, a, acc), null, "the person sees the account");
  assert.equal(await seesRollup(), undefined, "one linked invoice is not theirs to see: no sum at all (not 3000)");
  const body = JSON.stringify(await fieldsOf(m, a, acc));
  for (const frag of ["7000", "3000", "billed"])
    assert.equal(body.includes(frag), false, `the account carries "${frag}" for the person`);
  assert.equal(
    "billed_k" in ((await fieldsOf(m, a, acc)) ?? {}),
    false,
    "a formula over a hidden rollup is hidden too",
  );
  // the whole set is theirs once the third invoice is: the sum is whole
  await h.owner.call("access.share", {
    resource: { type: "record", id: i3 },
    subject: { kind: "person", id: m.personId },
    level: "view",
    idempotencyKey: `${tag}-i3`,
  });
  assert.equal(await seesRollup(), 7000, "control: every linked invoice visible, the person has the full sum");
  assert.equal((await fieldsOf(m, a, acc))?.["billed_k"], 7);
  // lookup: the invoice shows its account's name, unless the grant on the account hides name
  assert.deepEqual(
    (await fieldsOf(m, i, i1))?.["account_name"],
    [`Acme ${tag}`],
    "control: the lookup reads the account's name",
  );
  const n2 = await newMember(`narrow${tag}`);
  await grant(i1, n2, undefined, `${tag}-n2i`);
  await grant(acc, n2, ["name"], `${tag}-n2a`);
  assert.equal(
    "account_name" in ((await fieldsOf(n2, i, i1)) ?? {}),
    false,
    "the account's name is hidden from this person: so is the lookup of it",
  );
  assert.equal(JSON.stringify(await fieldsOf(n2, i, i1)).includes(`Acme ${tag}`), false);
  void i2;
});

test("a rollup is judged on the records it was computed FROM: an unseen link removed before the value is recomputed does not hand its amount to a person who could not see it", async () => {
  const tag = `st${++seq}`;
  const a = `acs${tag}`;
  const i = `ins${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type: a,
        def: {
          title: "Account",
          plural: "Accounts",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
      {
        op: "type.create",
        type: i,
        def: {
          title: "Invoice",
          plural: "Invoices",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "name" },
            { key: "amount", type: "number", title: "amount" },
          ],
        },
      },
      { op: "relation.add", type: i, field: "account", def: { to: a, inverse: "invoices" } },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-c`,
    ops: [
      {
        op: "field.add",
        type: a,
        field: "billed",
        def: { type: "rollup", title: "Billed", options: { via: "invoices", field: "amount", fn: "sum" } },
      },
    ],
  });
  const acc = (
    (await h.owner.call("records.create", { type: a, fields: { name: `Acme ${tag}` } })) as { record: { id: string } }
  ).record.id;
  const mk = async (name: string, amount: number): Promise<string> => {
    const r = (await h.owner.call("records.create", { type: i, fields: { name, amount } })) as {
      record: { id: string };
    };
    await h.owner.call("records.relate", { type: i, recordId: r.record.id, field: "account", toId: acc });
    return r.record.id;
  };
  await mk(`B ${tag}`, 1000);
  const hidden = await mk(`R ${tag}`, 7654);
  const m = await newMember(`st${tag}`);
  await grant(hidden, await newMember(`own${tag}`), undefined, `${tag}-own`); // only people added see R, and the member is not one of them
  await until(async () => (await fieldsOf(h.owner, a, acc))?.["billed"] === 8654);
  assert.equal((await fieldsOf(h.owner, a, acc))?.["billed"], 8654, "control: the owner has the sum of both");
  assert.equal("billed" in ((await fieldsOf(m, a, acc)) ?? {}), false, "the member cannot see R, so there is no sum");
  // hold the consumer, take R off the account, and read as the member before anything is recomputed
  const hooks = h.d.hooks!;
  const real = hooks.pump.bind(hooks);
  await real();
  await new Promise((r) => setTimeout(r, 300));
  await real();
  let held = 0;
  hooks.pump = (async () => {
    held++;
  }) as typeof hooks.pump;
  try {
    await h.owner.call("records.relate", { type: i, recordId: hidden, field: "account", toId: acc, unlink: true });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(held > 0, "the consumer was held");
    assert.equal(
      (await fieldsOf(h.owner, a, acc))?.["billed"],
      8654,
      "the stored value is still the old one while the consumer is held (the window is real)",
    );
    const seen = JSON.stringify(await fieldsOf(m, a, acc));
    for (const frag of ["8654", "7654", "1000", "billed"])
      assert.equal(seen.includes(frag), false, `during the gap the member's read of the account carries "${frag}"`);
  } finally {
    hooks.pump = real;
  }
  await until(async () => (await fieldsOf(h.owner, a, acc))?.["billed"] === 1000);
  assert.equal(
    (await fieldsOf(m, a, acc))?.["billed"],
    1000,
    "after the recompute the member sees the new sum, of the one invoice they may see",
  );
});

test("a record read as of an earlier time carries no computed value (it would be today's)", async () => {
  const tag = `ao${++seq}`;
  const type = `asof${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "L",
          plural: "Ls",
          icon: "table",
          titleField: "name",
          fields: [
            { key: "name", type: "text", title: "name" },
            { key: "qty", type: "number", title: "qty" },
          ],
        },
      },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-f`,
    ops: [
      { op: "field.add", type, field: "twice", def: { type: "formula", title: "Twice", options: { expr: "qty * 2" } } },
    ],
  });
  const id = (
    (await h.owner.call("records.create", { type, fields: { name: "x", qty: 2 } })) as { record: { id: string } }
  ).record.id;
  const then = Date.now();
  await new Promise((r) => setTimeout(r, 20));
  await h.owner.call("records.update", { type, recordId: id, patch: { qty: 50 } });
  await until(async () => (await fieldsOf(h.owner, type, id))?.["twice"] === 100);
  const past = (await h.owner.call("records.as_of", { type, recordId: id, at: then })) as {
    record: { fields: Record<string, unknown> };
  };
  assert.equal(past.record.fields["qty"], 2, "control: the record as it was");
  assert.equal(
    "twice" in past.record.fields,
    false,
    "no computed value in a past version (today's value would be wrong for it)",
  );
});

test("search never indexes a computed value: a person who cannot see the linked record cannot find the invoice by the account's name that its lookup holds", async () => {
  const tag = `sx${++seq}`;
  const a = `acx${tag}`;
  const i = `inx${tag}`;
  const WORD = `zqacct${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type: a,
        def: {
          title: "Account",
          plural: "Accounts",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
      {
        op: "type.create",
        type: i,
        def: {
          title: "Invoice",
          plural: "Invoices",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
      { op: "relation.add", type: i, field: "account", def: { to: a, inverse: "invoices" } },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-c`,
    ops: [
      {
        op: "field.add",
        type: i,
        field: "account_name",
        def: { type: "lookup", title: "Account name", options: { via: "account", field: "name" } },
      },
    ],
  });
  const acc = (
    (await h.owner.call("records.create", { type: a, fields: { name: WORD } })) as { record: { id: string } }
  ).record.id;
  const inv = (
    (await h.owner.call("records.create", { type: i, fields: { name: `Invoice ${tag}` } })) as {
      record: { id: string };
    }
  ).record.id;
  await h.owner.call("records.relate", { type: i, recordId: inv, field: "account", toId: acc });
  const m = await newMember(`sx${tag}`);
  await grant(acc, await newMember(`ownsx${tag}`), undefined, `${tag}-own`); // the account is for people added; the member is not one
  await until(
    async () => JSON.stringify((await fieldsOf(h.owner, i, inv))?.["account_name"]) === JSON.stringify([WORD]),
  );
  // the index folds the record's events (the owner finds the invoice by its own name)
  await until(async () => JSON.stringify(await h.owner.call("search.query", { q: `Invoice ${tag}` })).includes(inv));
  assert.equal(
    "account_name" in ((await fieldsOf(m, i, inv)) ?? {}),
    false,
    "control: the member's read has no lookup (the account is not theirs)",
  );
  // the value exists now: an edit of the invoice makes the index read it again, with its lookup in hand
  await h.owner.call("records.update", { type: i, recordId: inv, patch: { name: `Invoice ${tag} second` } });
  await until(async () => JSON.stringify(await h.owner.call("search.query", { q: `second ${tag}` })).includes(inv));
  await new Promise((r) => setTimeout(r, 300));
  await h.d.hooks?.pump?.();
  const hit = async (who: Pick<Person, "attempt">): Promise<boolean> => {
    const r = await who.attempt("search.query", { q: WORD });
    return JSON.stringify(r.data ?? null).includes(inv);
  };
  assert.equal(
    await hit(h.owner),
    false,
    "the owner finds the ACCOUNT by its name, not the invoice by the account's name (a lookup is not indexed)",
  );
  assert.equal(await hit(m), false, "the member cannot find the invoice by the lookup's text");
  assert.equal(
    JSON.stringify((await m.attempt("search.query", { q: `Invoice ${tag}` })).data ?? null).includes(WORD),
    false,
    "and no snippet of it carries that text",
  );
});

test("sort and filter by a computed field: the owner and a person who may read it sort and filter by the value; a person it is hidden from gets the default order whatever the hidden values are, and a filter on it is refused", async () => {
  const tag = `so${++seq}`;
  const type = `sort${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Line",
          plural: "Lines",
          icon: "table",
          titleField: "name",
          fields: ["name", "qty", "price"].map((key) => ({
            key,
            type: key === "name" ? "text" : "number",
            title: key,
          })),
        },
      },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-f`,
    ops: [
      {
        op: "field.add",
        type,
        field: "total",
        def: { type: "formula", title: "Total", options: { expr: "qty * price" } },
      },
    ],
  });
  // names a, b, c, d rise while the totals fall: the order by total is the reverse of the order by name
  const rows: Array<{ id: string; name: string }> = [];
  for (const [n, l] of ["a", "b", "c", "d"].entries()) {
    const name = `Row ${tag} ${l}`;
    const r = (await h.owner.call("records.create", { type, fields: { name, qty: 1, price: 40 - n * 10 } })) as {
      record: { id: string };
    };
    rows.push({ id: r.record.id, name });
  }
  const byName = rows.map((r) => r.id);
  const mine = new Set(byName);
  await until(async () => (await fieldsOf(h.owner, type, rows[3]!.id))?.["total"] === 10);
  const order = async (who: Pick<Person, "attempt">, spec: Record<string, unknown>): Promise<string[] | "refused"> => {
    const r = await who.attempt("records.query", { type, limit: 100, ...spec });
    return r.ok
      ? (r.data as { rows: Array<{ id: string }> }).rows.map((x) => x.id).filter((id) => mine.has(id))
      : "refused";
  };
  // the owner: sorted by the computed value both ways, and a filter on it
  assert.deepEqual(
    await order(h.owner, { sort: [{ field: "total", dir: "asc" }] }),
    byName.slice().reverse(),
    "the owner's sort by total, ascending",
  );
  assert.deepEqual(await order(h.owner, { sort: [{ field: "total", dir: "desc" }] }), byName, "descending");
  assert.deepEqual(
    await order(h.owner, { filter: { field: "total", op: "gt", value: 25 } }),
    [rows[0]!.id, rows[1]!.id].sort(),
    "the owner's filter total > 25 (40 and 30)",
  );
  assert.deepEqual(await order(h.owner, { filter: { field: "total", op: "eq", value: 10 } }), [rows[3]!.id], "equals");
  // the in-memory path (a filter the SQL cannot take: a value that is an object) carries the same values and the same order
  const odd = {
    or: [
      { field: "name", op: "eq", value: { a: 1 } },
      { field: "qty", op: "gte", value: 0 },
    ],
  };
  assert.deepEqual(
    await order(h.owner, { filter: odd, sort: [{ field: "total", dir: "asc" }] }),
    byName.slice().reverse(),
    "in memory: the owner's sort by total",
  );
  assert.deepEqual(
    await order(h.owner, { filter: { and: [odd, { field: "total", op: "gt", value: 25 }] } }),
    [rows[0]!.id, rows[1]!.id].sort(),
    "in memory: a filter on total",
  );
  const memoryRow = (await h.owner.call("records.query", {
    type,
    limit: 5,
    filter: odd,
    sort: [{ field: "total", dir: "asc" }],
  })) as { rows: Array<{ fields: Record<string, unknown> }> };
  assert.equal(
    memoryRow.rows[0]!.fields["total"],
    10,
    "and the row shows its total once, from the side table, not from the comparison copy",
  );
  // a person who may read every input (unrestricted on the type): the same
  const sighted = await newMember(`sighted${tag}`);
  assert.deepEqual(
    await order(sighted, { sort: [{ field: "total", dir: "asc" }] }),
    byName.slice().reverse(),
    "a person who may read it sorts by it",
  );
  assert.deepEqual(await order(sighted, { filter: { field: "total", op: "eq", value: 10 } }), [rows[3]!.id]);
  // a person whose grants hide price on these records: the field is empty for them
  const blind = await newMember(`blind${tag}`);
  for (const r of rows) await grant(r.id, blind, ["price"], `${tag}-g-${r.id}`);
  const plain = await order(blind, {});
  assert.ok(Array.isArray(plain) && plain.length === 4, "the person sees all four rows");
  const probes: Array<Record<string, unknown>> = [
    { sort: [{ field: "total", dir: "asc" }] },
    { sort: [{ field: "total", dir: "desc" }] },
    { group: "total" },
  ];
  for (const spec of probes)
    assert.deepEqual(
      await order(blind, spec),
      plain,
      `${JSON.stringify(spec)}: the hidden total does not order the rows`,
    );
  assert.equal(
    await order(blind, { filter: { field: "total", op: "gt", value: 25 } }),
    "refused",
    "a filter on a computed field they cannot read is refused",
  );
  // swap: the hidden prices are reversed; the person's orders are identical, the owner's follows the real values
  for (const [n, r] of rows.entries())
    await h.owner.call("records.update", { type, recordId: r.id, patch: { price: 10 + n * 10 } });
  await until(async () => (await fieldsOf(h.owner, type, rows[0]!.id))?.["total"] === 10);
  assert.deepEqual(
    await order(h.owner, { sort: [{ field: "total", dir: "asc" }] }),
    byName,
    "the owner's order followed the swap",
  );
  for (const spec of probes)
    assert.deepEqual(
      await order(blind, spec),
      plain,
      `after the swap ${JSON.stringify(spec)}: still the default order`,
    );
});

test("sorting invoices by a lookup of the account's name: a person who sees every invoice but not every account gets the default order, the owner and a person who sees both get the real one", async () => {
  const tag = `sl${++seq}`;
  const a = `acl${tag}`;
  const i = `inl${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type: a,
        def: {
          title: "Account",
          plural: "Accounts",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
      {
        op: "type.create",
        type: i,
        def: {
          title: "Invoice",
          plural: "Invoices",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
      { op: "relation.add", type: i, field: "account", def: { to: a, inverse: "invoices" } },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-c`,
    ops: [
      {
        op: "field.add",
        type: i,
        field: "account_name",
        def: { type: "lookup", title: "Account name", options: { via: "account", field: "name" } },
      },
    ],
  });
  // invoices a, b, c in this order, lent to accounts named so that the order by account name is c, b, a
  const accounts = [`Zed ${tag}`, `Mid ${tag}`, `Abe ${tag}`];
  const invoices: string[] = [];
  const accountIds: string[] = [];
  for (const [n, an] of accounts.entries()) {
    const acc = (
      (await h.owner.call("records.create", { type: a, fields: { name: an } })) as { record: { id: string } }
    ).record.id;
    accountIds.push(acc);
    const inv = (
      (await h.owner.call("records.create", { type: i, fields: { name: `Inv ${tag} ${n}` } })) as {
        record: { id: string };
      }
    ).record.id;
    await h.owner.call("records.relate", { type: i, recordId: inv, field: "account", toId: acc });
    invoices.push(inv);
  }
  await until(
    async () =>
      JSON.stringify((await fieldsOf(h.owner, i, invoices[2]!))?.["account_name"]) === JSON.stringify([accounts[2]]),
  );
  const mine = new Set(invoices);
  const order = async (who: Pick<Person, "attempt">, spec: Record<string, unknown>): Promise<string[] | "refused"> => {
    const r = await who.attempt("records.query", { type: i, limit: 100, ...spec });
    return r.ok
      ? (r.data as { rows: Array<{ id: string }> }).rows.map((x) => x.id).filter((id) => mine.has(id))
      : "refused";
  };
  const byAccount = [invoices[2]!, invoices[1]!, invoices[0]!];
  assert.deepEqual(
    await order(h.owner, { sort: [{ field: "account_name", dir: "asc" }] }),
    byAccount,
    "the owner sorts by the lookup",
  );
  const both = await newMember(`both${tag}`);
  assert.deepEqual(
    await order(both, { sort: [{ field: "account_name", dir: "asc" }] }),
    byAccount,
    "a person who sees every invoice and every account sorts by it too",
  );
  // the middle account is for people added, and this person is not one: they see all invoices, but not all accounts
  const some = await newMember(`some${tag}`);
  await grant(accountIds[1]!, await newMember(`aown${tag}`), undefined, `${tag}-aown`);
  const plain = await order(some, {});
  assert.ok(Array.isArray(plain) && plain.length === 3, "the person sees all three invoices");
  assert.deepEqual(
    await order(some, { sort: [{ field: "account_name", dir: "asc" }] }),
    plain,
    "the lookup of accounts they cannot all see does not order the invoices",
  );
  assert.deepEqual(await order(some, { sort: [{ field: "account_name", dir: "desc" }] }), plain, "descending too");
  assert.equal(
    await order(some, { filter: { field: "account_name", op: "contains", value: "Mid" } }),
    "refused",
    "and a filter on it is refused",
  );
});

test("export and records.search carry computed values by the same rule: the owner and a person who may read every input get them, a person with a hidden input gets no value and no row picked by it", async () => {
  const tag = `ex${++seq}`;
  const type = `expo${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Line",
          plural: "Lines",
          icon: "table",
          titleField: "name",
          fields: ["name", "qty", "price"].map((key) => ({
            key,
            type: key === "name" ? "text" : "number",
            title: key,
          })),
        },
      },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-f`,
    ops: [
      {
        op: "field.add",
        type,
        field: "total",
        def: { type: "formula", title: "Total", options: { expr: "qty * price" } },
      },
    ],
  });
  const rows: string[] = [];
  for (const [n, l] of ["a", "b", "c"].entries()) {
    const r = (await h.owner.call("records.create", {
      type,
      fields: { name: `Exp ${tag} ${l}`, qty: 1, price: 4001 + n },
    })) as { record: { id: string } };
    rows.push(r.record.id);
  }
  await until(async () => (await fieldsOf(h.owner, type, rows[2]!))?.["total"] === 4003);
  // a role that may export, for both people
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const made = (
    await h.owner.call("access.roles.create", {
      name: `Exporter ${tag}`,
      cloneFrom: roles.find((r) => r.name === "Member")!.id,
    })
  ).role as { id: string; permissions: string[] };
  const permissions = [...new Set([...made.permissions, "records.export"])];
  const prev = await h.owner.call("access.roles.preview", { roleId: made.id, permissions });
  await h.owner.call("access.roles.apply", { roleId: made.id, permissions, previewHash: prev.previewHash });
  const exporter = async (name: string): Promise<Person> => {
    const inv = await h.owner.call("members.invites.create", { role: made.id, email: `${name}@firm.test` });
    const n = h.person(`Exp ${name}`, name, `${name}@firm.test`, `${name} horse battery staple 9`);
    await joined(n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!));
    return n;
  };
  const fileText = async (
    who: Pick<Person, "call" | "attempt">,
    input: Record<string, unknown>,
  ): Promise<string | "refused"> => {
    const asked = await who.attempt("records.export", { type, format: "csv", ...input });
    if (!asked.ok) return "refused";
    const read = (await who.call("files.read", { fileId: (asked.data as { fileId: string }).fileId, as: "text" })) as {
      text?: string;
      base64?: string;
    };
    return read.text ?? Buffer.from(read.base64 ?? "", "base64").toString("utf8");
  };
  // one export each per person and day (a file of the same name in their folder is a duplicate), so each probe is a person of its own
  const blindOne = async (name: string): Promise<Person> => {
    const p = await exporter(`${name}${tag}`);
    for (const id of rows) await grant(id, p, ["price"], `${tag}-${name}-${id}`);
    return p;
  };
  const sighted = await exporter(`sx${tag}`);
  for (const id of rows) await grant(id, sighted, undefined, `${tag}-s-${id}`);
  const blind = await blindOne("bx");
  const ownerFile = String(await fileText(h.owner, { filter: { field: "total", op: "gt", value: 4001 } }));
  for (const v of ["4002", "4003"])
    assert.ok(ownerFile.includes(v), `control: the owner's file, filtered by total, has total ${v}`);
  assert.equal(ownerFile.includes(`Exp ${tag} a`), false, "and the filter left out the row with 4001");
  const sightedFile = String(await fileText(sighted, {}));
  assert.ok(
    sightedFile.includes("4002") && sightedFile.includes("4001"),
    "control: a person who may read price and qty has the totals in their file",
  );
  const blindFile = String(await fileText(blind, {}));
  assert.ok(blindFile.includes(`Exp ${tag} a`), "the blind person's file has the rows (names)");
  for (const v of ["4001", "4002", "4003"])
    assert.equal(blindFile.includes(v), false, `the blind person's file carries ${v}`);
  // no row picked by a value they cannot read
  const byTotal = String(await fileText(await blindOne("bt"), { filter: { field: "total", op: "gt", value: 4001 } }));
  assert.equal(
    byTotal.includes(`Exp ${tag} b`) || byTotal.includes(`Exp ${tag} c`),
    false,
    "a filter on the hidden total picks no row for them",
  );
  const byPrice = String(await fileText(await blindOne("bp"), { filter: { field: "price", op: "gt", value: 4001 } }));
  assert.equal(
    byPrice.includes(`Exp ${tag} b`) || byPrice.includes(`Exp ${tag} c`),
    false,
    "nor does a filter on the hidden price",
  );
  // records.search shows the row with its computed value to those who may read it
  const found = async (who: Pick<Person, "attempt">): Promise<Record<string, unknown> | null> => {
    const r = await who.attempt("records.search", { type, q: `Exp ${tag} b` });
    return r.ok
      ? ((r.data as { rows: Array<{ id: string; fields: Record<string, unknown> }> }).rows.find((x) => x.id === rows[1])
          ?.fields ?? null)
      : null;
  };
  assert.equal((await found(h.owner))?.["total"], 4002, "control: the owner's search result has the total");
  assert.equal((await found(sighted))?.["total"], 4002, "control: so has the person who may read it");
  const seenByBlind = await found(blind);
  assert.ok(seenByBlind && seenByBlind["name"] === `Exp ${tag} b`, "the blind person finds the row");
  assert.equal("total" in seenByBlind, false, "without a total");
});

test("records.get_many carries computed values by the same rule: the owner and a person who may read every input have them, a person with a hidden input has none", async () => {
  const tag = `gm${++seq}`;
  const type = `many${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Line",
          plural: "Lines",
          icon: "table",
          titleField: "name",
          fields: ["name", "qty", "price"].map((key) => ({ key, type: key === "name" ? "text" : "number", title: key })),
        },
      },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-f`,
    ops: [{ op: "field.add", type, field: "total", def: { type: "formula", title: "Total", options: { expr: "qty * price" } } }],
  });
  const ids: string[] = [];
  for (const n of [0, 1, 2]) {
    const r = (await h.owner.call("records.create", { type, fields: { name: `Many ${tag} ${n}`, qty: 2, price: 5001 + n } })) as { record: { id: string } };
    ids.push(r.record.id);
  }
  const sighted = await newMember(`gs${tag}`);
  const blind = await newMember(`gb${tag}`);
  for (const id of ids) {
    await grant(id, sighted, undefined, `${tag}-s-${id}`);
    await grant(id, blind, ["price"], `${tag}-b-${id}`);
  }
  await until(async () => (await fieldsOf(h.owner, type, ids[2]!))?.["total"] === 10004);
  const many = async (who: Pick<Person, "attempt">): Promise<Array<{ id: string; fields: Record<string, unknown>; computedAt?: Record<string, number> }>> => {
    const r = await who.attempt("records.get_many", { type, ids });
    assert.ok(r.ok, "get_many was answered");
    return (r.data as { rows: Array<{ id: string; fields: Record<string, unknown>; computedAt?: Record<string, number> }> }).rows;
  };
  assert.deepEqual((await many(h.owner)).map((r) => r.fields["total"]), [10002, 10004, 10006], "control: the owner has every total");
  assert.deepEqual((await many(sighted)).map((r) => r.fields["total"]), [10002, 10004, 10006], "control: a person who may read price and qty has them too");
  const rows = await many(blind);
  assert.equal(rows.length, 3, "the blind person has all three rows");
  for (const r of rows) {
    assert.equal("total" in r.fields, false, "no total for the person whose grant hides price");
    assert.equal(r.computedAt, undefined, "and no stamp of when it was computed");
  }
  const body = JSON.stringify(rows);
  for (const frag of ["10002", "10004", "10006", "5001", "5002", "5003"]) assert.equal(body.includes(frag), false, `get_many for the blind person carries "${frag}"`);
});
