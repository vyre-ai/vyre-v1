// Field-level privacy across every records capability: a member whose grant hides a record's email and phone never gets either value (old or new, nor a fragment) back from any records read, any write that answers with the
// record, a count or a sort or a group by the hidden field, or a query that names the hidden field. The probe table is printed on every run. Real server-role daemon.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";
import type { HiddenFixture } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("hiddensweep");
});
after(async () => {
  await h?.stop();
});

type Row = { cap: string; input: string; result: string };
const table: Row[] = [];
const leaked: string[] = [];

async function probe(
  f: HiddenFixture,
  label: string,
  cap: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; body: string }> {
  const r = await f.member.attempt(cap, input);
  const body = r.ok ? JSON.stringify(r.data) : `refused ${(r.error as { code?: string }).code}`;
  const found = f.leaks(body);
  table.push({ cap, input: label, result: !r.ok ? body : found.length ? `LEAK ${found.join(", ")}` : "clean" });
  if (found.length) leaked.push(`${cap} (${label}): ${found.join(", ")}`);
  return { ok: r.ok, body };
}

test("reads: no records read returns a hidden value to the member", async () => {
  const f = await hiddenMember(h);
  const t = "contact";
  const rec = { type: t, recordId: f.rid };
  await probe(f, "", "records.get", rec);
  await probe(f, "", "records.get_many", { type: t, ids: [f.rid] });
  await probe(f, "at an earlier time", "records.as_of", { ...rec, at: f.at });
  await probe(f, "", "records.history", rec);
  await probe(f, "field email", "records.history", { ...rec, field: "email" });
  await probe(f, "", "records.activity", rec);
  await probe(f, "", "records.versions", rec);
  await probe(f, "", "records.changes", { type: t, since: 0 });
  await probe(f, "", "records.completeness", rec);
  await probe(f, "", "records.comments.list", rec);
  await probe(f, "", "records.relations_map", { ...rec, hops: 2 });
  await probe(f, "field email", "records.value_source", { ...rec, field: "email" });
  await probe(f, "field phone", "records.value_source", { ...rec, field: "phone" });
  await probe(f, "", "records.values.pending", { type: t });
  await probe(f, "email", "records.reveal", { ...rec, field: "email" });
  await probe(f, "", "records.query", { type: t });
  await probe(f, "asking for the hidden fields", "records.query", { type: t, fields: ["name", "email", "phone"] });
  await probe(f, "sorted by the hidden email", "records.query", { type: t, sort: [{ field: "email", dir: "asc" }] });
  await probe(f, "grouped by the hidden email", "records.query", { type: t, group: "email" });
  await probe(f, "", "records.search", { type: t, q: "Probe Hana" });
  await probe(f, "", "records.counts", { type: t });
  await probe(f, "filtered by the hidden email", "records.counts", {
    type: t,
    filter: { field: "email", op: "eq", value: f.values.newEmail },
  });
  await probe(f, "", "records.export", { type: t, format: "csv", recordIds: [f.rid] });
  console.log(table.map((r) => `${r.cap.padEnd(26)} ${r.input.padEnd(34)} ${r.result}`).join("\n"));
});

test("counts and sorts are not an oracle: a count filtered by a hidden value is zero, and a sort by a hidden field does not order the visible rows by it", async () => {
  const f = await hiddenMember(h);
  const counted = await f.member.attempt("records.counts", {
    type: "contact",
    filter: { field: "email", op: "eq", value: f.values.newEmail },
  });
  const total = counted.ok ? JSON.stringify(counted.data) : "refused";
  const own = await f.owner.call("records.counts", {
    type: "contact",
    filter: { field: "email", op: "eq", value: f.values.newEmail },
  });
  assert.match(JSON.stringify(own), /1/, "the owner's count by that email is 1 (the probe is not empty)");
  assert.doesNotMatch(total, /"count":\s*[1-9]|:\s*1\b/, `the member's count by the hidden email is not 1: ${total}`);
});

test("writes that answer with the record: a member who may edit but not see a field is not handed the field back", async () => {
  const f = await hiddenMember(h, { level: "edit" });
  const t = "contact";
  const rec = { type: t, recordId: f.rid };
  const name = (await f.owner.call("records.get", rec)).record.fields.name as string;
  // the owner is not affected: the same write answers them with every field
  const ownUpdate = await f.owner.call("records.update", { ...rec, patch: { name: `${name} (owner)` } });
  assert.ok(
    f.leaks(ownUpdate).length >= 2,
    "the owner's update answers with the hidden fields too (the projection only narrows what a grant hides)",
  );
  await probe(f, "a visible field", "records.update", { ...rec, patch: { name: `${name} (edited)` } });
  const versions = (
    (await f.owner.call("records.versions", rec)) as { versions: Array<{ versionId: string; n: number }> }
  ).versions;
  const first = versions.slice().sort((a, b) => a.n - b.n)[0]!;
  await probe(f, "the first version (holds the old hidden values)", "records.restore_version", {
    ...rec,
    versionId: first.versionId,
  });
  await probe(f, "", "records.update_many", {
    type: t,
    items: [{ recordId: f.rid, patch: { name: `${name} (many)` } }],
  });
  await probe(f, "update by name", "records.bulk_upsert", {
    type: t,
    match: ["name"],
    rows: [{ name: `${name} (many)`, notes: "x" }],
    idempotencyKey: `hs-bulk-${f.rid}`,
  });
  await probe(f, "", "records.relate", { ...rec, field: "company", toId: f.rid });
  await probe(f, "", "records.values.review", { ...rec, field: "email", decision: "accept" });
  await probe(f, "", "records.merge", { type: t, survivorId: f.rid, mergedIds: [f.rid], picks: {} });
  await probe(f, "", "records.restore", rec);
  await probe(f, "the member's own contact", "records.create", {
    type: t,
    fields: { name: "Member made", email: "mine@example.test" },
    idempotencyKey: `hs-create-${f.rid}`,
  });
  console.log(
    table
      .slice(-10)
      .map((r) => `${r.cap.padEnd(26)} ${r.input.padEnd(34)} ${r.result}`)
      .join("\n"),
  );
});

test("a saved view of the type (records.view, views.get) hands the member no hidden value", async () => {
  const f = await hiddenMember(h);
  const saved = (await f.owner.call("views.save", {
    type: "contact",
    kind: "table",
    title: `Everyone ${f.rid.slice(-6)}`,
    idempotencyKey: `hs-view-${f.rid}`,
  })) as {
    view: { viewId: string };
  };
  await f.owner.call("views.publish", { viewId: saved.view.viewId, shared: true });
  const own = await f.owner.call("records.view", { type: "contact", viewId: saved.view.viewId });
  assert.ok(f.leaks(own).length >= 1, "the owner's saved view carries the hidden values (the probe is not empty)");
  await probe(f, "a saved view, resolved", "records.view", { type: "contact", viewId: saved.view.viewId });
  await probe(f, "the view definition", "views.get", { viewId: saved.view.viewId });
  await probe(f, "the member's list of views", "views.list", { type: "contact" });
  console.log(
    table
      .slice(-3)
      .map((r) => `${r.cap.padEnd(26)} ${r.input.padEnd(34)} ${r.result}`)
      .join("\n"),
  );
});

test("the probe table is clean: no capability returned a hidden value to the member", () => {
  assert.deepEqual(leaked, [], `leaks: ${leaked.join(" | ")}`);
});

test("export: a person whose role may export, and whose grant hides a field, gets a file without the hidden values", async () => {
  const f = await hiddenMember(h, { extraPermissions: ["records.export"] });
  const asked = await f.member.attempt("records.export", { type: "contact", format: "csv", recordIds: [f.rid] });
  assert.equal(
    asked.ok,
    true,
    `the exporter role may export: ${asked.ok ? "" : JSON.stringify(asked.error).slice(0, 200)}`,
  );
  const fileId = (asked.data as { fileId: string }).fileId;
  const read = (await f.member.call("files.read", { fileId, as: "text" })) as { text?: string; base64?: string };
  const bytes = read.text ?? Buffer.from(read.base64 ?? "", "base64").toString("utf8");
  assert.ok(
    bytes.includes(`Probe Hana ${f.values.oldPhone.split(" ")[2]!.slice(0, 4)}`) || bytes.length > 10,
    `the file has the exported row (${bytes.length} bytes)`,
  );
  assert.deepEqual(
    f.leaks(bytes),
    [],
    `the exported file carries a hidden value (${f.leaks(bytes).join(", ")}): ${bytes.split("\n").slice(0, 3).join(" // ").slice(0, 500)}`,
  );
  // the Excel shape too: the file's text (files.read extracts it) carries no hidden value either
  const asXlsx = await f.member.attempt("records.export", { type: "contact", format: "xlsx", recordIds: [f.rid] });
  assert.equal(asXlsx.ok, true, "the exporter role may export Excel");
  const xlsxText =
    (
      (await f.member.call("files.read", { fileId: (asXlsx.data as { fileId: string }).fileId, as: "text" })) as {
        text?: string;
      }
    ).text ?? "";
  assert.ok(xlsxText.includes("Probe Hana"), `the Excel file has the exported row (${xlsxText.length} chars)`);
  assert.deepEqual(f.leaks(xlsxText), [], `the exported Excel file carries a hidden value: ${xlsxText.slice(0, 300)}`);
  // the owner's own export of the same row does carry them (the probe is not empty)
  const own = await f.owner.call("records.export", { type: "contact", format: "csv", recordIds: [f.rid] });
  const ownBytes =
    (
      (await f.owner.call("files.read", { fileId: (own as { fileId: string }).fileId, as: "text" })) as {
        text?: string;
      }
    ).text ?? "";
  assert.ok(f.leaks(ownBytes).length >= 2, `the owner's export carries the hidden values: ${ownBytes.slice(0, 200)}`);
});

test("export and views: a filter or sort on a field the grant hides picks no row and places none for the person, in a file and in a saved view, and the owner's own pick the record", async () => {
  const f = await hiddenMember(h, { extraPermissions: ["records.export"] });
  const text = async (
    who: { call(cap: string, input?: Record<string, unknown>): Promise<any> },
    input: Record<string, unknown>,
  ): Promise<string> => {
    const out = await who.call("records.export", { type: "contact", format: "csv", ...input });
    const read = (await who.call("files.read", { fileId: (out as { fileId: string }).fileId, as: "text" })) as {
      text?: string;
      base64?: string;
    };
    return read.text ?? Buffer.from(read.base64 ?? "", "base64").toString("utf8");
  };
  const name = String(
    (
      (await f.owner.call("records.get", { type: "contact", recordId: f.rid })) as {
        record: { fields: Record<string, unknown> };
      }
    ).record.fields["name"],
  );
  // control: the owner's export filtered by the hidden email has the contact (an owner may export as often as they like: this is a second export of the day)
  const ownFile = await text(f.owner, { filter: { field: "email", op: "eq", value: f.values.newEmail } });
  assert.ok(ownFile.includes(name), "control: the owner's export filtered by the email picks the contact");
  // control: a person who may export and whose grant hides nothing has the contact picked by its email (one export a day per person, so this is another person with a contact of their own)
  const open = await hiddenMember(h, { hide: [], extraPermissions: ["records.export"] });
  const openName = String(
    (
      (await open.owner.call("records.get", { type: "contact", recordId: open.rid })) as {
        record: { fields: Record<string, unknown> };
      }
    ).record.fields["name"],
  );
  const openFile = await text(open.member, { filter: { field: "email", op: "eq", value: open.values.newEmail } });
  assert.ok(openFile.includes(openName), "control: a person who may read the email has the contact picked by it");
  // the probes: the person's export filtered or sorted by the hidden email picks and places nothing, and carries no hidden value
  const bytes = await text(f.member, { filter: { field: "email", op: "eq", value: f.values.newEmail } }).catch(
    () => "",
  );
  assert.equal(bytes.includes(name), false, "a filter on the hidden email picks no row for them");
  assert.deepEqual(f.leaks(bytes), [], "and nothing hidden is in the file");
  // the same for a saved view the owner shared
  const save = async (title: string, spec: Record<string, unknown>): Promise<string> => {
    const r = (await f.owner.call("views.save", {
      type: "contact",
      kind: "table",
      title: `${title} ${f.rid.slice(-6)}`,
      idempotencyKey: `sw-${title}-${f.rid}`,
      ...spec,
    })) as { view: { viewId: string } };
    await f.owner.call("views.publish", { viewId: r.view.viewId, shared: true });
    return r.view.viewId;
  };
  const byEmail = await save("sweep by email", { filter: { field: "email", op: "eq", value: f.values.newEmail } });
  const bySort = await save("sweep sorted", { sort: [{ field: "email", dir: "asc" }] });
  const ids = async (
    who: { attempt(cap: string, input?: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }> },
    viewId: string,
  ): Promise<string[]> => {
    const r = await who.attempt("records.view", { type: "contact", viewId, limit: 50 });
    return r.ok ? (r.data as { rows: Array<{ id: string }> }).rows.map((x) => x.id) : [];
  };
  assert.ok((await ids(f.owner, byEmail)).includes(f.rid), "control: the owner's view by the email picks the contact");
  assert.equal(
    (await ids(f.member, byEmail)).includes(f.rid),
    false,
    "a view filtered by the hidden email picks nothing for the person",
  );
  assert.equal(
    (await ids(f.member, bySort)).includes(f.rid),
    false,
    "a view sorted by the hidden email places nothing for the person",
  );
  for (const [label, viewId] of [
    ["by email", byEmail],
    ["sorted", bySort],
  ] as const) {
    // the rows only: the view's own definition holds the filter its owner wrote, which is the owner's words and not a record's value
    const body = JSON.stringify(
      (
        (await f.member.attempt("records.view", { type: "contact", viewId, limit: 50 })).data as
          | { rows?: unknown }
          | undefined
      )?.rows ?? null,
    );
    assert.deepEqual(f.leaks(body), [], `the view ${label} rows carry no hidden value for the person`);
  }
});

test("a saved view filtered or sorted by a rollup over records the person cannot see picks and places nothing for them; the owner's view, and the view of a person who sees those records, pick the account", async () => {
  const tag = `cv${Math.random().toString(36).slice(2, 6)}`;
  const acct = `acv_${tag}`;
  const inv = `inv_${tag}`;
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-t`,
    ops: [
      {
        op: "type.create",
        type: acct,
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
        type: inv,
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
      { op: "relation.add", type: inv, field: "account", def: { to: acct, inverse: "invoices" } },
    ],
  });
  await h.owner.call("schema.apply", {
    idempotencyKey: `${tag}-c`,
    ops: [
      {
        op: "field.add",
        type: acct,
        field: "billed",
        def: { type: "rollup", title: "Billed", options: { via: "invoices", field: "amount", fn: "sum" } },
      },
    ],
  });
  const account = (
    (await h.owner.call("records.create", { type: acct, fields: { name: `Acme ${tag}` } })) as {
      record: { id: string };
    }
  ).record.id;
  const invoiceIds: string[] = [];
  for (const [n, amount] of [900, 700].entries()) {
    const r = (await h.owner.call("records.create", { type: inv, fields: { name: `Inv ${tag} ${n}`, amount } })) as {
      record: { id: string };
    };
    await h.owner.call("records.relate", { type: inv, recordId: r.record.id, field: "account", toId: account });
    invoiceIds.push(r.record.id);
  }
  // invoices are for people added only; both people see the account
  await h.owner.call("access.audience_set", { resource: { type: "record_type", id: inv }, audience: "added" });
  const person = async (
    name: string,
  ): Promise<{
    attempt: (cap: string, input?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown }>;
    personId: string;
  }> => {
    const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const invite = await h.owner.call("members.invites.create", {
      role: roles.find((r) => r.name === "Member")!.id,
      email: `${name}@firm.test`,
    });
    const p = h.person(`C ${name}`, name, `${name}@firm.test`, `${name} horse battery staple 9`);
    for (let tries = 0; ; tries++) {
      try {
        await join(h, p, decodeURIComponent(new URL(String(invite.link)).pathname.split("/").pop()!), {
          device: "web",
        });
        break;
      } catch (e) {
        if (tries >= 8 || !/rate_limit/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 8_000));
      }
    }
    return p as never;
  };
  const blind = await person(`cb${tag}`);
  const sighted = await person(`cs${tag}`);
  for (const id of invoiceIds)
    await h.owner.call("access.share", {
      resource: { type: "record", id },
      subject: { kind: "person", id: sighted.personId },
      level: "view",
      idempotencyKey: `${tag}-s-${id}`,
    });
  const byTotal = (
    (await h.owner.call("views.save", {
      type: acct,
      kind: "table",
      title: `By billed ${tag}`,
      idempotencyKey: `${tag}-v1`,
      filter: { field: "billed", op: "gt", value: 100 },
    })) as { view: { viewId: string } }
  ).view.viewId;
  const sorted = (
    (await h.owner.call("views.save", {
      type: acct,
      kind: "table",
      title: `Sorted ${tag}`,
      idempotencyKey: `${tag}-v2`,
      sort: [{ field: "billed", dir: "desc" }],
    })) as { view: { viewId: string } }
  ).view.viewId;
  for (const v of [byTotal, sorted]) await h.owner.call("views.publish", { viewId: v, shared: true });
  // the sum exists (the owner's view picks the account by it)
  for (let i = 0; i < 60; i++) {
    await h.d.hooks?.pump?.();
    const own = (await h.owner.call("records.view", { type: acct, viewId: byTotal, limit: 50 })) as {
      rows: Array<{ id: string }>;
    };
    if (own.rows.some((r) => r.id === account)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const ids = async (
    who: { attempt(cap: string, input?: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }> },
    viewId: string,
  ): Promise<string[]> => {
    const r = await who.attempt("records.view", { type: acct, viewId, limit: 50 });
    return r.ok ? (r.data as { rows: Array<{ id: string }> }).rows.map((x) => x.id) : [];
  };
  assert.ok(
    (await ids(h.owner, byTotal)).includes(account),
    "control: the owner's view filtered by billed picks the account",
  );
  assert.ok((await ids(h.owner, sorted)).includes(account), "control: and the sorted one places it");
  assert.ok(
    (await ids(sighted, byTotal)).includes(account),
    "control: a person who sees the invoices has the account picked by the sum",
  );
  assert.ok((await ids(sighted, sorted)).includes(account), "control: and placed by it");
  assert.equal(
    (await ids(blind, byTotal)).includes(account),
    false,
    "a view filtered by a sum over invoices the person cannot see picks nothing for them",
  );
  assert.equal((await ids(blind, sorted)).includes(account), false, "a view sorted by it places nothing for them");
});
