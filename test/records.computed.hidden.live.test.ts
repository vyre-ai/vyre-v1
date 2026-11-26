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
const newMember = async (tag: string): Promise<Person> => {
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `${tag}@firm.test`,
  });
  const n = h.person(`Computed ${tag}`, tag, `${tag}@firm.test`, `${tag} horse battery staple 9`);
  await join(h, n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
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
