// A saved view carries its own filter and sort, and records.view runs them on the server. A person whose grant hides a field must not be handed the rows that field's value picked: before, a view filtered by a hidden
// email returned the contacts with that email (the column cut), so the view said which record had which hidden value, and its total counted them. Real server-role daemon, real access and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { hiddenMember } from "./support/hidden-member.ts";

let h: Hour;
before(async () => {
  h = await bootHour("vieworacle");
});
after(async () => {
  await h?.stop();
});

test("a view filtered or sorted by a field the grant hides picks and places nothing for that person; the owner's view and a view on a visible field are unchanged", async () => {
  const f = await hiddenMember(h);
  const save = async (title: string, spec: Record<string, unknown>): Promise<string> => {
    const r = (await h.owner.call("views.save", {
      type: "contact",
      kind: "table",
      title: `${title} ${f.rid.slice(-6)}`,
      idempotencyKey: `vo-${title}-${f.rid}`,
      ...spec,
    })) as { view: { viewId: string } };
    await h.owner.call("views.publish", { viewId: r.view.viewId, shared: true });
    return r.view.viewId;
  };
  const byEmail = await save("by email", { filter: { field: "email", op: "eq", value: f.values.newEmail } });
  const byName = await save("by name", { filter: { field: "name", op: "contains", value: "Probe Hana" } });
  const sorted = await save("sorted", { sort: [{ field: "email", dir: "asc" }] });
  const rowsOf = async (
    who: { attempt(cap: string, input?: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }> },
    viewId: string,
  ): Promise<string[]> => {
    const r = await who.attempt("records.view", { type: "contact", viewId });
    return r.ok ? (r.data as { rows: Array<{ id: string }> }).rows.map((x) => x.id) : [];
  };
  // controls: the owner's views pick the contact by its email and by its name; the person's view on the visible name picks it too
  assert.ok((await rowsOf(h.owner, byEmail)).includes(f.rid), "control: the owner's view by email picks the contact");
  assert.ok(
    (await rowsOf(f.member, byName)).includes(f.rid),
    "control: the person's view by the visible name picks it",
  );
  // the probes
  assert.equal(
    (await rowsOf(f.member, byEmail)).includes(f.rid),
    false,
    "a view filtered by the hidden email picks no row for the person",
  );
  const total = await f.member.attempt("records.view", { type: "contact", viewId: byEmail });
  assert.equal(
    total.ok
      ? (total.data as { total?: number }).total === undefined || (total.data as { total: number }).total === 0
      : true,
    true,
    "and its total does not count the rows the hidden value picked",
  );
  assert.equal(
    (await rowsOf(f.member, sorted)).includes(f.rid),
    false,
    "a view sorted by the hidden email places no row for the person",
  );
});

test("paging a view and its total say nothing about the records left out: the pages at limit 1 are the pages of a table without them, and there is no total", async () => {
  const tag = `vp${Math.random().toString(36).slice(2, 6)}`;
  const mk = async (name: string): Promise<string> =>
    (
      (await h.owner.call("records.create", {
        type: "contact",
        fields: { name: `Pg ${tag} ${name}`, email: `${name}-${tag}@probe-mail.test` },
      })) as { record: { id: string } }
    ).record.id;
  const a = await mk("a");
  const b = await mk("b");
  const c = await mk("c");
  const d = await mk("d");
  // the person may read email on a, b and d, and not on c (the one in the middle of the order by name)
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `vp${tag}@firm.test`,
  });
  const p = h.person(`V ${tag}`, `vp${tag}`, `vp${tag}@firm.test`, `vp${tag} horse battery staple 9`);
  for (let tries = 0; ; tries++) {
    try {
      await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
      break;
    } catch (e) {
      if (tries >= 8 || !/rate_limit/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 8_000));
    }
  }
  for (const id of [a, b, c, d]) {
    await h.owner.call("access.audience_set", { resource: { type: "record", id }, audience: "added" });
    await h.owner.call("access.share", {
      resource: { type: "record", id },
      subject: { kind: "person", id: p.personId },
      level: "view",
      ...(id === c ? { conditions: { hiddenFields: ["email"] } } : {}),
      idempotencyKey: `${tag}-${id}`,
    });
  }
  const saved = (await h.owner.call("views.save", {
    type: "contact",
    kind: "table",
    title: `Paged ${tag}`,
    idempotencyKey: `vp-${tag}`,
    filter: { field: "email", op: "contains", value: tag },
    sort: [{ field: "name", dir: "asc" }],
  })) as { view: { viewId: string } };
  await h.owner.call("views.publish", { viewId: saved.view.viewId, shared: true });
  const step = async (cursor?: string): Promise<{ rows: Array<{ id: string }>; next?: string; total?: number }> => {
    const r = await p.attempt("records.view", {
      type: "contact",
      viewId: saved.view.viewId,
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    assert.ok(r.ok, "the view was answered");
    return r.data as { rows: Array<{ id: string }>; next?: string; total?: number };
  };
  const seen: string[][] = [];
  let cursor: string | undefined;
  let total: number | undefined;
  for (let i = 0; i < 8; i++) {
    const page = await step(cursor);
    if (i === 0) total = page.total;
    seen.push(page.rows.map((r) => r.id));
    cursor = page.next;
    if (!cursor) break;
  }
  assert.deepEqual(seen.flat(), [a, b, d], "the person's pages hold a, b and d, in order, and nothing else");
  assert.ok(
    seen.every((p2) => p2.length >= 1),
    "no page came short because a record was left out (the page that would have held c holds d)",
  );
  assert.equal(
    total,
    undefined,
    "no total for the person: a count of what the view picked would count the record left out",
  );
  // control: the owner's pages hold all four
  const own = (await h.owner.call("records.view", { type: "contact", viewId: saved.view.viewId, limit: 10 })) as {
    rows: Array<{ id: string }>;
  };
  assert.deepEqual(
    own.rows.map((r) => r.id).filter((id) => [a, b, c, d].includes(id)),
    [a, b, c, d],
    "control: the owner's view has all four",
  );
});

test("a Manage grant on the type that hides a field, and a record grant with a row filter on a view that names no field, are judged record by record like anyone: the page sequence is the one of a table without the records they may not have", async () => {
  const tag = `vm${Math.random().toString(36).slice(2, 6)}`;
  const type = `vw_${tag}`;
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
          fields: ["name", "email"].map((key) => ({ key, type: "text", title: key })),
        },
      },
    ],
  });
  // email is tagged on every record; c is the one in the middle of the order by name
  const names = ["a", "b", "c", "d"].map((l) => `Mg ${tag} ${l}`);
  const id: Record<string, string> = {};
  for (const [n, name] of names.entries()) {
    const r = (await h.owner.call("records.create", {
      type,
      fields: { name, email: `${n === 2 ? "hidden" : "shown"}-${tag}@probe-mail.test` },
    })) as { record: { id: string } };
    id[name] = r.record.id;
  }
  const [a, b, c, d] = names.map((n) => id[n]!);
  const person = async (
    name: string,
  ): Promise<{
    attempt: (cap: string, input?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown }>;
    personId: string;
  }> => {
    const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const inv = await h.owner.call("members.invites.create", {
      role: roles.find((r) => r.name === "Member")!.id,
      email: `${name}@firm.test`,
    });
    const p = h.person(`V ${name}`, name, `${name}@firm.test`, `${name} horse battery staple 9`);
    for (let tries = 0; ; tries++) {
      try {
        await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
        break;
      } catch (e) {
        if (tries >= 8 || !/rate_limit/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 8_000));
      }
    }
    return p as never;
  };
  const view = async (title: string, spec: Record<string, unknown>): Promise<string> => {
    const saved = (await h.owner.call("views.save", {
      type,
      kind: "table",
      title: `${title} ${tag}`,
      idempotencyKey: `vm-${title}-${tag}`,
      ...spec,
    })) as { view: { viewId: string } };
    await h.owner.call("views.publish", { viewId: saved.view.viewId, shared: true });
    return saved.view.viewId;
  };
  const pagesOf = async (
    p: { attempt: (cap: string, input?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown }> },
    viewId: string,
  ): Promise<string[][]> => {
    const out: string[][] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 8; i++) {
      const r = await p.attempt("records.view", { type, viewId, limit: 1, ...(cursor ? { cursor } : {}) });
      assert.ok(r.ok, `the view was answered: ${JSON.stringify(r.ok ? "" : r).slice(0, 200)}`);
      const page = r.data as { rows: Array<{ id: string }>; next?: string; total?: number };
      assert.equal(page.total, undefined, "no total for them");
      out.push(page.rows.map((x) => x.id));
      cursor = page.next;
      if (!cursor) break;
    }
    return out;
  };
  // (2) grants on the records one by one, with a row filter on c's that takes c away, and a view that names no field at all
  const filtered = await person(`rf${tag}`);
  for (const rid of [a, b, c, d]) {
    await h.owner.call("access.audience_set", { resource: { type: "record", id: rid }, audience: "added" });
    await h.owner.call("access.share", {
      resource: { type: "record", id: rid },
      subject: { kind: "person", id: filtered.personId },
      level: "view",
      ...(rid === c ? { conditions: { rowFilter: { op: "eq", field: "name", value: "nothing has this name" } } } : {}),
      idempotencyKey: `${tag}-r-${rid}`,
    });
  }
  const plain = await view("plain", { sort: [{ field: "name", dir: "asc" }] });
  const pages = await pagesOf(filtered, plain);
  assert.deepEqual(pages.flat(), [a, b, d], "a row filter takes c away: the pages hold a, b, d");
  assert.ok(
    pages.slice(0, 3).every((p) => p.length >= 1),
    "and no page before the last came short because c was cut",
  );
  // (1) Manage on the whole type, with email hidden (the table is open to people added only, so the grant is the whole of their access): a view by email must not pick or place c by it
  await h.owner.call("access.audience_set", { resource: { type: "record_type", id: type }, audience: "added" });
  const manager = await person(`mg${tag}`);
  await h.owner.call("access.share", {
    resource: { type: "record_type", id: type },
    subject: { kind: "person", id: manager.personId },
    level: "manage",
    conditions: { hiddenFields: ["email"] },
    idempotencyKey: `${tag}-m`,
  });
  const byHidden = await view("by hidden", {
    filter: { field: "email", op: "contains", value: "hidden" },
    sort: [{ field: "name", dir: "asc" }],
  });
  assert.deepEqual(
    (await pagesOf(manager, byHidden)).flat(),
    [],
    "a Manage grant that hides email: the view picked by 'hidden' picks nothing for them",
  );
  const byTag = await view("by tag", {
    filter: { field: "email", op: "contains", value: tag },
    sort: [{ field: "name", dir: "asc" }],
  });
  assert.deepEqual(
    (await pagesOf(manager, byTag)).flat(),
    [],
    "and a view that matches every record by the hidden email places and picks none of them for a person who may not read it",
  );
  // control: the owner's view picks c
  const own = (await h.owner.call("records.view", { type, viewId: byHidden, limit: 10 })) as {
    rows: Array<{ id: string }>;
  };
  assert.deepEqual(
    own.rows.map((r) => r.id),
    [c],
    "control: the owner's view by 'hidden' picks c",
  );
});

test("control for probe 1, on the contact table as it is (open to the Member role): a Manage grant that hides email takes nothing away, because the role still gives email; the view picks the contact legitimately", async () => {
  const tag = `p1${Math.random().toString(36).slice(2, 6)}`;
  const mk = async (name: string, email: string): Promise<string> =>
    (
      (await h.owner.call("records.create", { type: "contact", fields: { name: `P1 ${tag} ${name}`, email } })) as {
        record: { id: string };
      }
    ).record.id;
  const a = await mk("a", `a-${tag}@other.test`);
  const x = await mk("b", `x-${tag}@probe.test`);
  await mk("c", `c-${tag}@other.test`);
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `p1${tag}@firm.test`,
  });
  const p = h.person(`P1 ${tag}`, `p1${tag}`, `p1${tag}@firm.test`, `p1${tag} horse battery staple 9`);
  for (let tries = 0; ; tries++) {
    try {
      await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
      break;
    } catch (e) {
      if (tries >= 8 || !/rate_limit/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 8_000));
    }
  }
  const shared = await h.owner.attempt("access.share", {
    resource: { type: "record_type", id: "contact" },
    subject: { kind: "person", id: p.personId },
    level: "manage",
    conditions: { hiddenFields: ["email"] },
    idempotencyKey: `${tag}-m`,
  });
  const saved = (await h.owner.call("views.save", {
    type: "contact",
    kind: "table",
    title: `Probe ${tag}`,
    idempotencyKey: `p1-${tag}`,
    filter: { field: "email", op: "contains", value: `x-${tag}@probe.test` },
    sort: [{ field: "name", dir: "asc" }],
  })) as { view: { viewId: string } };
  await h.owner.call("views.publish", { viewId: saved.view.viewId, shared: true });
  const r = await p.attempt("records.view", { type: "contact", viewId: saved.view.viewId, limit: 1 });
  const picked = r.ok ? (r.data as { rows: Array<{ id: string }> }).rows.map((q) => q.id) : [];
  console.log(
    `PROBE1 share ${shared.ok ? "accepted" : `refused ${JSON.stringify(shared.error).slice(0, 120)}`}; the member's view by hidden email answered ${r.ok ? "rows " + picked.length : "refused"}; picks the contact: ${picked.includes(x)}; a: ${picked.includes(a)}`,
  );
  const own = (await h.owner.call("records.view", { type: "contact", viewId: saved.view.viewId, limit: 10 })) as {
    rows: Array<{ id: string }>;
  };
  assert.deepEqual(
    own.rows.map((q) => q.id),
    [x],
    "control: the owner's view picks the one contact",
  );
  assert.equal(shared.ok, true, "the grant is accepted");
  assert.equal(
    picked.includes(x),
    true,
    "the Member role gives them email on every contact (grants add up), so the view picks the contact for them, as it should; narrowing is the other test, on a table open to people added only",
  );
});

test("control for probe 2, on the contact table as it is (open to the Member role): a type grant with a row filter on owner takes nothing away; the pages are all four, none short", async () => {
  const tag = `p2${Math.random().toString(36).slice(2, 6)}`;
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const inv = await h.owner.call("members.invites.create", {
    role: roles.find((r) => r.name === "Member")!.id,
    email: `p2${tag}@firm.test`,
  });
  const p = h.person(`P2 ${tag}`, `p2${tag}`, `p2${tag}@firm.test`, `p2${tag} horse battery staple 9`);
  for (let tries = 0; ; tries++) {
    try {
      await join(h, p, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
      break;
    } catch (e) {
      if (tries >= 8 || !/rate_limit/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 8_000));
    }
  }
  const mk = async (
    who: { call: (cap: string, input?: Record<string, unknown>) => Promise<any> },
    name: string,
  ): Promise<string> =>
    (
      (await who.call("records.create", { type: "contact", fields: { name: `P2 ${tag} ${name}` } })) as {
        record: { id: string };
      }
    ).record.id;
  const ids: string[] = [];
  for (const [who, n] of [
    [p, "a"],
    [h.owner, "b"],
    [p, "c"],
    [h.owner, "d"],
  ] as const)
    ids.push(await mk(who, n));
  const shared = await h.owner.attempt("access.share", {
    resource: { type: "record_type", id: "contact" },
    subject: { kind: "person", id: p.personId },
    level: "view",
    conditions: { rowFilter: { op: "eq", field: "owner_id", value: p.personId } },
    idempotencyKey: `${tag}-rf`,
  });
  const saved = (await h.owner.call("views.save", {
    type: "contact",
    kind: "table",
    title: `Probe2 ${tag}`,
    idempotencyKey: `p2-${tag}`,
    filter: { field: "name", op: "contains", value: `P2 ${tag}` },
  })) as { view: { viewId: string } };
  await h.owner.call("views.publish", { viewId: saved.view.viewId, shared: true });
  const pages: string[][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 8; i++) {
    const r = await p.attempt("records.view", {
      type: "contact",
      viewId: saved.view.viewId,
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    if (!r.ok) break;
    const page = r.data as { rows: Array<{ id: string }>; next?: string };
    pages.push(page.rows.map((q) => q.id).filter((id) => ids.includes(id)));
    cursor = page.next;
    if (!cursor) break;
  }
  console.log(
    `PROBE2 share ${shared.ok ? "accepted" : `refused ${JSON.stringify(shared.error).slice(0, 120)}`}; pages ${JSON.stringify(pages.map((q) => q.map((id) => "abcd"[ids.indexOf(id)])))}`,
  );
  assert.equal(shared.ok, true, "the grant is accepted");
  assert.deepEqual(
    pages.flat().map((id) => "abcd"[ids.indexOf(id)]),
    ["a", "b", "c", "d"],
    "the Member role gives them every contact, so all four are theirs, in order, none short",
  );
});
