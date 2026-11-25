// A field a grant hides is not an oracle through ORDER, COUNT or the PAST. A member whose grant hides email and phone on several contacts must not learn the order of the hidden values (a sort or a group by the hidden field),
// must not count rows by them, and must find no hidden value or fragment in the history, versions, as-of or activity of a record, before or after the owner changed it. Every probe has a control: the owner (or a visible
// field) shows the probe can see something. Real server-role daemon, real access and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddenorder");
});
after(async () => {
  await h?.stop();
});

let seq = 0;
async function newMember(tag: string): Promise<Person> {
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `${tag}@firm.test`,
  });
  const n = h.person(`Order ${tag}`, tag, `${tag}@firm.test`, `${tag} horse battery staple 9`);
  await join(h, n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  return n;
}
async function shareHiding(rid: string, n: Person, key: string, hide = ["email", "phone"]): Promise<void> {
  const ref = { type: "record", id: rid };
  await h.owner.call("access.audience_set", { resource: ref, audience: "added" });
  await h.owner.call("access.share", {
    resource: ref,
    subject: { kind: "person", id: n.personId },
    level: "view",
    conditions: { hiddenFields: hide },
    idempotencyKey: key,
  });
}
const ids = (out: { rows: Array<{ id: string }> }): string[] => out.rows.map((r) => r.id);

test("sort and group by a hidden field do not order the member's rows by the hidden values", async () => {
  const tag = `so${++seq}x${Math.random().toString(36).slice(2, 6)}`;
  // names rise a, b, c, d while the hidden emails fall: the order by email is the reverse of the order by name
  const made: Array<{ id: string; name: string; email: string }> = [];
  for (const [i, l] of ["a", "b", "c", "d"].entries()) {
    const name = `Ord ${tag} ${l}`;
    const email = `${String(9 - i)}-${tag}@probe-mail.test`;
    const r = (await h.owner.call("records.create", {
      type: "contact",
      fields: { name, email, phone: `+1 555 ${i}${tag.length}77` },
    })) as { record: { id: string } };
    made.push({ id: r.record.id, name, email });
  }
  const n = await newMember(`ord${tag}`);
  for (const m of made) await shareHiding(m.id, n, `ord-${m.id}`);
  const mine = new Set(made.map((m) => m.id));
  const q = async (who: Pick<Person, "attempt">, spec: Record<string, unknown>): Promise<string[] | "refused"> => {
    const r = await who.attempt("records.query", { type: "contact", limit: 500, ...spec });
    if (!r.ok) return "refused";
    return ids(r.data as { rows: Array<{ id: string }> }).filter((id) => mine.has(id));
  };
  const own = h.owner as unknown as Pick<Person, "attempt">;
  const byEmail = made
    .slice()
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((m) => m.id);
  const byName = made.map((m) => m.id);

  // controls: the owner's sort by the email works and differs from the order by name; the member's sort by the visible name works both ways
  assert.deepEqual(
    await q(own, { sort: [{ field: "email", dir: "asc" }] }),
    byEmail,
    "the owner's sort by email orders by email",
  );
  assert.notDeepEqual(byEmail, byName, "the fixture's email order is not the name order");
  assert.deepEqual(
    await q(n, { sort: [{ field: "name", dir: "asc" }] }),
    byName,
    "the member sorts by the visible name",
  );
  assert.deepEqual(
    await q(n, { sort: [{ field: "name", dir: "desc" }] }),
    byName.slice().reverse(),
    "the member sorts by the visible name, descending",
  );
  const plain = await q(n, {});
  assert.notEqual(plain, "refused");
  assert.equal((plain as string[]).length, 4, "the member sees all four contacts");

  // the probes: the hidden field does not order the member's rows (it is refused, or it is the order the member gets with no sort at all)
  const probes: Record<string, Record<string, unknown>> = {
    "sort by the hidden email, ascending": { sort: [{ field: "email", dir: "asc" }] },
    "sort by the hidden email, descending": { sort: [{ field: "email", dir: "desc" }] },
    "sort by the hidden phone": { sort: [{ field: "phone", dir: "asc" }] },
    "hidden email as the first of two sort keys": {
      sort: [
        { field: "email", dir: "asc" },
        { field: "name", dir: "asc" },
      ],
    },
    "group by the hidden email": { group: "email" },
    "group by the hidden phone": { group: "phone" },
  };
  const rows: string[] = [];
  for (const [label, spec] of Object.entries(probes)) {
    const got = await q(n, spec);
    rows.push(
      `${label.padEnd(44)} ${got === "refused" ? "refused" : got.map((id) => made.findIndex((m) => m.id === id)).join(",")}`,
    );
    // refused, or no rows at all (the sort fails closed), or the member's own order: none of them orders by a hidden value
    if (got === "refused" || got.length === 0) continue;
    assert.deepEqual(
      got,
      plain,
      `${label}: the member's order follows the hidden values (got ${got.join(",")}, unsorted ${(plain as string[]).join(",")})`,
    );
  }
  console.log(rows.join("\n"));
  // the member's own answer never carries a hidden value, whatever it is sorted by
  const body = JSON.stringify(
    (await n.attempt("records.query", { type: "contact", sort: [{ field: "email", dir: "asc" }], limit: 500 })).data ??
      null,
  );
  for (const m of made) assert.equal(body.includes(m.email), false, "a hidden email is in the sorted answer");
});

test("counts by a hidden field are not an oracle: a count of rows with a hidden fragment is 0 for the member", async () => {
  const tag = `cn${++seq}x${Math.random().toString(36).slice(2, 6)}`;
  const r = (await h.owner.call("records.create", {
    type: "contact",
    fields: { name: `Cnt ${tag}`, email: `${tag}@probe-mail.test`, phone: `+1 555 ${tag.length}0123` },
  })) as { record: { id: string } };
  const n = await newMember(`cnt${tag}`);
  await shareHiding(r.record.id, n, `cnt-${r.record.id}`);
  const count = async (who: Pick<Person, "attempt">, filter: unknown): Promise<number | "refused"> => {
    const a = await who.attempt("records.counts", { type: "contact", filter });
    return a.ok ? (a.data as { count: number }).count : "refused";
  };
  const own = h.owner as unknown as Pick<Person, "attempt">;
  assert.equal(
    await count(own, { field: "email", op: "contains", value: tag }),
    1,
    "the owner counts the contact by a fragment of its email",
  );
  assert.equal(
    await count(n, { field: "name", op: "contains", value: tag }),
    1,
    "the member counts it by the visible name",
  );
  for (const [label, f] of [
    ["email contains the fragment", { field: "email", op: "contains", value: tag }],
    ["email equals", { field: "email", op: "eq", value: `${tag}@probe-mail.test` }],
    ["phone contains", { field: "phone", op: "contains", value: "0123" }],
  ] as const) {
    const got = await count(n, f);
    assert.ok(got === 0 || got === "refused", `${label}: the member's count is ${String(got)}, not 0`);
  }
  // a filter that mixes a visible match with a hidden one does not tell which half matched
  const both = await count(n, {
    and: [
      { field: "name", op: "contains", value: tag },
      { field: "email", op: "contains", value: tag },
    ],
  });
  assert.ok(both === 0 || both === "refused", `a visible and a hidden condition together count ${String(both)}`);
});

test("the history, versions, as-of and activity of a record carry no hidden value or fragment, before the owner changed it or after", async () => {
  const tag = `hv${++seq}x${Math.random().toString(36).slice(2, 6)}`;
  const hid = `q${Math.random().toString(36).slice(2, 8)}z`;
  const OLD = `old-${hid}@probe-mail.test`;
  const NEW = `new-${hid}@probe-mail.test`;
  const OLD_PH = `+1 555 ${String(8000 + seq)}1`;
  const NEW_PH = `+1 555 ${String(8000 + seq)}2`;
  const made = (await h.owner.call("records.create", {
    type: "contact",
    fields: { name: `Hist ${tag}`, email: OLD, phone: OLD_PH },
  })) as { record: { id: string } };
  const rid = made.record.id;
  const n = await newMember(`hist${tag}`);
  await shareHiding(rid, n, `hv-${rid}`);
  const hidden = [OLD, NEW, OLD_PH, NEW_PH, hid, `555 ${8000 + seq}1`, `555 ${8000 + seq}2`];
  const rec = { type: "contact", recordId: rid };
  const answers: Array<[string, string]> = [];
  const ask = async (stage: string, at: number): Promise<void> => {
    for (const [label, cap, input] of [
      ["history", "records.history", rec],
      ["history of email", "records.history", { ...rec, field: "email" }],
      ["history of phone", "records.history", { ...rec, field: "phone" }],
      ["activity", "records.activity", rec],
      ["versions", "records.versions", rec],
      ["as of the start", "records.as_of", { ...rec, at: t0 }],
      ["as of between", "records.as_of", { ...rec, at }],
      ["as of now", "records.as_of", { ...rec, at: Date.now() }],
      ["changes", "records.changes", { type: "contact", since: 0 }],
    ] as Array<[string, string, Record<string, unknown>]>) {
      const r = await n.attempt(cap, input);
      answers.push([
        `${stage} ${label}`,
        r.ok ? JSON.stringify(r.data) : `refused ${(r.error as { code?: string }).code}`,
      ]);
    }
  };
  const t0 = Date.now() - 1;
  // BEFORE the owner changes the hidden values: the log holds only the first ones
  await ask("before", t0 + 1);
  await new Promise((r) => setTimeout(r, 20));
  const between = Date.now();
  await h.owner.call("records.update", { ...rec, patch: { email: NEW, phone: NEW_PH } });
  await h.owner.call("records.update", { ...rec, patch: { name: `Hist ${tag} B` } });
  // AFTER: the old and the new values are both in the log
  await ask("after", between);

  // control: the owner's history and versions DO carry the hidden values, so the probe can see them
  const ownBody = JSON.stringify([
    await h.owner.call("records.history", rec),
    await h.owner.call("records.versions", rec),
    await h.owner.call("records.as_of", { ...rec, at: between }),
    await h.owner.call("records.get", rec),
  ]);
  assert.ok(
    ownBody.includes(OLD) && ownBody.includes(NEW),
    `the owner's history and versions carry both emails: ${ownBody.slice(0, 200)}`,
  );
  assert.ok(ownBody.includes(OLD_PH), "the owner's history carries the old phone");
  // and the member's answers are not all refusals: the history of the visible name answers
  const answered = answers.filter(([, b]) => !b.startsWith("refused"));
  assert.ok(answered.length >= 3, `the member's past answers at least three of the probes (${answered.length})`);
  assert.ok(
    answered.some(([l, b]) => l.startsWith("after") && b.includes(`Hist ${tag} B`)),
    "an answer after the change carries the visible new name (the probe sees the change)",
  );
  console.log(
    answers.map(([l, b]) => `${l.padEnd(28)} ${b.startsWith("refused") ? b : `${b.length} chars`}`).join("\n"),
  );
  for (const [label, body] of answers)
    for (const v of hidden)
      assert.equal(
        body.includes(v),
        false,
        `${label}: the hidden text "${v}" is in the member's answer: ${body.slice(0, 300)}`,
      );
});

test("a field the type has retired, which a grant still hides, is not found by search or shown in the member's answers", async () => {
  const tag = `rt${++seq}x${Math.random().toString(36).slice(2, 6)}`;
  const type = `dossier${tag}`;
  const SECRET = `zqsecret${tag}`;
  const ops = [
    {
      op: "type.create",
      type,
      def: {
        title: "Dossier",
        plural: "Dossiers",
        icon: "table",
        titleField: "name",
        fields: ["name", "note", "memo"].map((key) => ({ key, type: "text", title: key })),
      },
    },
  ];
  await h.owner.call("schema.apply", { idempotencyKey: `rt-type-${tag}`, ops });
  const made = (await h.owner.call("records.create", {
    type,
    fields: { name: `Retire ${tag}`, note: `the ${SECRET} note`, memo: `a visible memo ${tag}` },
  })) as { record: { id: string } };
  const rid = made.record.id;
  const n = await newMember(`ret${tag}`);
  await shareHiding(rid, n, `rt-${rid}`, ["note"]);
  const found = async (who: Pick<Person, "attempt">, q: string): Promise<{ hit: boolean; body: string }> => {
    const r = await who.attempt("records.search", { type, q });
    const body = r.ok ? JSON.stringify(r.data) : "refused";
    return { hit: r.ok && (r.data as { rows: Array<{ id: string }> }).rows.some((x) => x.id === rid), body };
  };
  const g = async (q: string): Promise<{ hit: boolean; body: string }> => {
    const r = await n.attempt("search.query", { q });
    const body = r.ok ? JSON.stringify(r.data) : "refused";
    return { hit: body.includes(rid), body };
  };
  const own = h.owner as unknown as Pick<Person, "attempt">;
  // controls: the owner finds the record by the secret word; the member finds it by the visible name and memo, and not by the hidden note
  assert.equal((await found(own, SECRET)).hit, true, "the owner finds the dossier by the note");
  assert.equal((await found(n, `Retire ${tag}`)).hit, true, "the member finds it by the visible name");
  assert.equal((await found(n, `a visible memo`)).hit, true, "the member finds it by the visible memo");
  assert.equal((await found(n, SECRET)).hit, false, "before the retire: the hidden note does not find it");
  // the owner retires the field; the grant still names it
  const diff = (await h.owner.call("schema.diff", { ops: [{ op: "field.drop", type, field: "note" }] })) as {
    previewToken: string;
    items: Array<{ itemKey: string; destructive: boolean }>;
  };
  await h.owner.call("schema.apply", {
    idempotencyKey: `rt-drop-${tag}`,
    ops: [{ op: "field.drop", type, field: "note" }],
    previewToken: diff.previewToken,
    confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey),
  });
  const schema = JSON.stringify(await h.owner.call("schema.types.get", { type }));
  assert.equal(schema.includes('"key":"note"'), false, "the type no longer has the note field");
  for (const [label, q] of [
    ["the whole word", SECRET],
    ["a fragment", SECRET.slice(0, 9)],
    ["the word and the name", `${SECRET} Retire`],
  ] as const) {
    const a = await found(n, q);
    assert.equal(
      a.hit,
      false,
      `after the retire, a search for ${label} finds the record as the member: ${a.body.slice(0, 300)}`,
    );
    assert.equal(
      a.body.includes(SECRET),
      false,
      `after the retire, the member's search answer for ${label} carries the hidden word`,
    );
    const w = await g(q);
    assert.equal(
      w.hit,
      false,
      `after the retire, the Space-wide search for ${label} finds the record as the member: ${w.body.slice(0, 300)}`,
    );
  }
  assert.equal(
    (await found(n, `Retire ${tag}`)).hit,
    true,
    "after the retire the member still finds it by the visible name",
  );
  const got = await n.attempt("records.get", { type, recordId: rid });
  assert.equal(
    JSON.stringify(got.data ?? null).includes(SECRET),
    false,
    "records.get after the retire carries no hidden word",
  );
  const past = JSON.stringify([
    (await n.attempt("records.history", { type, recordId: rid })).data ?? null,
    (await n.attempt("records.versions", { type, recordId: rid })).data ?? null,
  ]);
  assert.equal(
    past.includes(SECRET),
    false,
    `the history or versions after the retire carry the hidden word: ${past.slice(0, 300)}`,
  );
});
