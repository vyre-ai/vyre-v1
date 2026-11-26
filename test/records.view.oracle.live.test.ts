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
