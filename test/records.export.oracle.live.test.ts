// A filter or a sort given to records.export must not pick or place a record by a field the caller cannot read on it: such a record is left out of the file. Before, the file held the rows the hidden value picked
// (with that column cut), so a person who may export, and whose grant hides a field, could ask "which rows have price over X" and read the answer off the file. Real server-role daemon, real access and records modules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("exportoracle");
});
after(async () => {
  await h?.stop();
});

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

test("a filter or a sort on a field the caller cannot read leaves the record out of their export, and the owner's export is unchanged", async () => {
  const tag = `eo${Math.random().toString(36).slice(2, 6)}`;
  const type = `expo_${tag}`;
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
          fields: ["name", "price"].map((key) => ({ key, type: key === "name" ? "text" : "number", title: key })),
        },
      },
    ],
  });
  const ids: string[] = [];
  for (const [n, l] of ["a", "b", "c"].entries()) {
    const r = (await h.owner.call("records.create", {
      type,
      fields: { name: `Exp ${tag} ${l}`, price: 7001 + n },
    })) as { record: { id: string } };
    ids.push(r.record.id);
  }
  // a role that may export
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const made = (
    await h.owner.call("access.roles.create", {
      name: `Exporter ${tag}`,
      cloneFrom: roles.find((r) => r.name === "Member")!.id,
    })
  ).role as {
    id: string;
    permissions: string[];
  };
  const permissions = [...new Set([...made.permissions, "records.export"])];
  const prev = await h.owner.call("access.roles.preview", { roleId: made.id, permissions });
  await h.owner.call("access.roles.apply", { roleId: made.id, permissions, previewHash: prev.previewHash });
  // one export per person and day (a file of the same name in their folder is a duplicate), so each probe is a person of its own
  const person = async (name: string, hide: string[] | undefined): Promise<Person> => {
    const inv = await h.owner.call("members.invites.create", { role: made.id, email: `${name}@firm.test` });
    const n = h.person(`E ${name}`, name, `${name}@firm.test`, `${name} horse battery staple 9`);
    await joined(n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!));
    for (const id of ids) {
      await h.owner.call("access.audience_set", { resource: { type: "record", id }, audience: "added" });
      await h.owner.call("access.share", {
        resource: { type: "record", id },
        subject: { kind: "person", id: n.personId },
        level: "view",
        ...(hide ? { conditions: { hiddenFields: hide } } : {}),
        idempotencyKey: `${tag}-${name}-${id}`,
      });
    }
    return n;
  };
  const fileText = async (who: Pick<Person, "call" | "attempt">, input: Record<string, unknown>): Promise<string> => {
    const asked = await who.attempt("records.export", { type, format: "csv", ...input });
    assert.ok(asked.ok, `the export was answered: ${JSON.stringify(asked.ok ? "" : asked.error).slice(0, 200)}`);
    const read = (await who.call("files.read", { fileId: (asked.data as { fileId: string }).fileId, as: "text" })) as {
      text?: string;
      base64?: string;
    };
    return read.text ?? Buffer.from(read.base64 ?? "", "base64").toString("utf8");
  };
  const sighted = await person(`sx${tag}`, undefined);
  const byFilter = await person(`bf${tag}`, ["price"]);
  const bySort = await person(`bs${tag}`, ["price"]);
  const plain = await person(`bp${tag}`, ["price"]);
  // controls: the owner's filtered file has the rows over 7001 (and the price column); a person who may read price gets them too
  const owner = await fileText(h.owner, { filter: { field: "price", op: "gt", value: 7001 } });
  assert.ok(
    owner.includes(`Exp ${tag} b`) && owner.includes(`Exp ${tag} c`) && !owner.includes(`Exp ${tag} a`),
    "control: the owner's filter picks b and c",
  );
  const own2 = await fileText(sighted, { filter: { field: "price", op: "gt", value: 7001 } });
  assert.ok(
    own2.includes(`Exp ${tag} b`) && !own2.includes(`Exp ${tag} a`),
    "control: a person who may read price has their rows picked by it",
  );
  // and without a filter the person whose grant hides price has every row, without the price column
  const all = await fileText(plain, {});
  for (const l of ["a", "b", "c"]) assert.ok(all.includes(`Exp ${tag} ${l}`), `without a filter the file has row ${l}`);
  for (const v of ["7001", "7002", "7003"]) assert.equal(all.includes(v), false, `and no price (${v})`);
  // the probes
  const filtered = await fileText(byFilter, { filter: { field: "price", op: "gt", value: 7001 } });
  assert.equal(
    filtered.includes(`Exp ${tag} b`) || filtered.includes(`Exp ${tag} c`),
    false,
    "a filter on the hidden price picks no row for them",
  );
  assert.equal(filtered.includes(`Exp ${tag} a`), false, "nor does it say which rows it passed over");
  const sorted = await fileText(bySort, { sort: [{ field: "price", dir: "desc" }] });
  for (const l of ["a", "b", "c"])
    assert.equal(sorted.includes(`Exp ${tag} ${l}`), false, `a sort by the hidden price places no row (${l}) for them`);
});

test("stepping the offset of an export does not count the records left out: the file at every offset is the file of the records the caller may have", async () => {
  const tag = `eoff${Math.random().toString(36).slice(2, 6)}`;
  const type = `expo_${tag}`;
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
          fields: ["name", "price"].map((key) => ({ key, type: key === "name" ? "text" : "number", title: key })),
        },
      },
    ],
  });
  // three records in the order of their names; the price is readable on a and c and hidden on b, and every price matches the filter
  const ids: string[] = [];
  for (const [n, l] of ["a", "b", "c"].entries()) {
    const r = (await h.owner.call("records.create", { type, fields: { name: `Off ${tag} ${l}`, price: 100 + n } })) as {
      record: { id: string };
    };
    ids.push(r.record.id);
  }
  const roles = (await h.owner.call("access.roles.list")).roles as Array<{ id: string; name: string }>;
  const made = (
    await h.owner.call("access.roles.create", {
      name: `Exporter ${tag}`,
      cloneFrom: roles.find((r) => r.name === "Member")!.id,
    })
  ).role as {
    id: string;
    permissions: string[];
  };
  const permissions = [...new Set([...made.permissions, "records.export"])];
  const prev = await h.owner.call("access.roles.preview", { roleId: made.id, permissions });
  await h.owner.call("access.roles.apply", { roleId: made.id, permissions, previewHash: prev.previewHash });
  const person = async (name: string): Promise<Person> => {
    const inv = await h.owner.call("members.invites.create", { role: made.id, email: `${name}@firm.test` });
    const n = h.person(`E ${name}`, name, `${name}@firm.test`, `${name} horse battery staple 9`);
    await joined(n, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!));
    for (const [at, id] of ids.entries()) {
      await h.owner.call("access.audience_set", { resource: { type: "record", id }, audience: "added" });
      await h.owner.call("access.share", {
        resource: { type: "record", id },
        subject: { kind: "person", id: n.personId },
        level: "view",
        ...(at === 1 ? { conditions: { hiddenFields: ["price"] } } : {}),
        idempotencyKey: `${tag}-${name}-${id}`,
      });
    }
    return n;
  };
  const fileText = async (who: Pick<Person, "call" | "attempt">, input: Record<string, unknown>): Promise<string> => {
    const asked = await who.attempt("records.export", { type, format: "csv", ...input });
    assert.ok(asked.ok, `the export was answered: ${JSON.stringify(asked.ok ? "" : asked.error).slice(0, 200)}`);
    const read = (await who.call("files.read", { fileId: (asked.data as { fileId: string }).fileId, as: "text" })) as {
      text?: string;
      base64?: string;
    };
    return read.text ?? Buffer.from(read.base64 ?? "", "base64").toString("utf8");
  };
  const spec = { filter: { field: "price", op: "gte", value: 100 }, sort: [{ field: "name", dir: "asc" }], limit: 1 };
  const has = (text: string): string => ["a", "b", "c"].filter((l) => text.includes(`Off ${tag} ${l}`)).join("");
  // control: the owner steps through all three, one at a time
  const owner0 = await fileText(h.owner, { ...spec, offset: 0 });
  assert.equal(has(owner0), "a", "control: the owner's first step is a");
  // the person may have a and c (b is hidden by price on b, and the filter names price): offset 0, 1, 2 give a, c, nothing, exactly as if b did not exist
  const got: string[] = [];
  for (const offset of [0, 1, 2]) got.push(has(await fileText(await person(`o${offset}${tag}`), { ...spec, offset })));
  assert.deepEqual(got, ["a", "c", ""], "offset 0, 1, 2 give a, c and nothing: the record left out takes no step");
});

test("a person can export as often as they like: the second file of the day has a name of its own, and the call never fails over a name", async () => {
  const tag = `tw${Math.random().toString(36).slice(2, 6)}`;
  const type = `expo_${tag}`;
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
          fields: [{ key: "name", type: "text", title: "name" }],
        },
      },
    ],
  });
  await h.owner.call("records.create", { type, fields: { name: `Twice ${tag}` } });
  const names: string[] = [];
  const fileIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const out = (await h.owner.call("records.export", { type, format: "csv" })) as { fileId: string };
    fileIds.push(out.fileId);
    const got = (await h.owner.call("files.get", { fileId: out.fileId })) as {
      file?: { name?: string };
      name?: string;
    };
    names.push(String(got.file?.name ?? got.name));
    const read = (await h.owner.call("files.read", { fileId: out.fileId, as: "text" })) as { text?: string };
    assert.ok(String(read.text).includes(`Twice ${tag}`), `export ${i + 1} holds the record`);
  }
  assert.equal(new Set(fileIds).size, 3, "three exports, three files");
  assert.equal(new Set(names).size, 3, `three names: ${names.join(" | ")}`);
  assert.match(names[1]!, /\(2\)\.csv$/, "the second is named with a counter");
  assert.match(names[2]!, /\(3\)\.csv$/, "and the third");
});
