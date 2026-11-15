// F47: a step may name only a mailbox, number or connection its saver may use. The check is the product's own (ctx.authorize at Use), run on save as the person saving. A step the saver did not touch is left
// as it is (nothing is migrated), and every refusal names the step.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, fixtureMayUse } from "../fixtures/db.ts";
import { alice, bob, create } from "../fixtures/seed.ts";

const MINE = "mbx_alice0000001";
const THEIRS = "mbx_bob00000001";
const def = (nodes: unknown[]) => ({ triggers: [{ key: "manual" }], nodes, start: [(nodes[0] as { id: string }).id] });
const mail = (mailboxId: string) => ({
  id: "n1",
  key: "send_email",
  input: { mailboxId, to: ["x@example.com"], subject: "S", body: "B" },
});
const sms = (numberId: string) => ({ id: "n1", key: "send_sms", input: { numberId, to: "+15550100", body: "B" } });
const request = (connectionId: string) => ({
  id: "n1",
  key: "connector_request",
  input: { connector: "acme", action: "list", connectionId },
});
const world = () => harness();
const refusal = async (h: ReturnType<typeof world>, nodes: unknown[], who = bob) => {
  try {
    await h.call("automations.create", create({ definition: def(nodes), idempotencyKey: `k${Math.random()}` }), who);
    return null;
  } catch (e) {
    return { code: codeOf(e), message: String((e as { error?: { message?: string } }).error?.message ?? "") };
  }
};

test("a step naming another person's mailbox, number or connection is refused at save, in words that name the step", async () => {
  const h = world();
  for (const [step, thing] of [
    [mail(MINE), "mailbox"],
    [sms("num_alice0000001"), "number"],
    [request("con_alice0000001"), "connection"],
  ] as const) {
    const r = await refusal(h, [step]);
    assert.ok(r, `${thing}: the save passed`);
    assert.equal(r!.code, "validation.precondition_failed");
    assert.match(r!.message, new RegExp(`you cannot use the ${thing} it names`), r!.message);
    assert.match(r!.message, /^(Send an email|Send a text message|Authenticated request):/, "names the step");
    assert.doesNotMatch(r!.message, /mbx_|num_|con_/, "no id in the words");
  }
});

test("the person's own things, and a shared connection they may use, save", async () => {
  const h = world();
  assert.equal(await refusal(h, [mail(MINE)], alice), null);
  assert.equal(await refusal(h, [sms("num_alice0000001")], alice), null);
  assert.equal(await refusal(h, [request("con_shared0000001")], bob), null, "a shared connection bob may use");
});

test("an update touches only what changed: an existing step that names a thing the saver may not use is left alone, a new or changed one is refused", async () => {
  const h = world();
  const made = await h.call(
    "automations.create",
    create({ definition: def([mail(MINE)]), idempotencyKey: "own" }),
    alice,
  );
  const id = made.automation.id as string;
  // alice's colleague (the saver now) renames the automation's other step, leaving the mailbox step as it was: not refused for the step they did not touch
  await h.call("automations.update", { automationId: id, name: "Renamed", idempotencyKey: "u1" }, alice);
  const changed = h.call(
    "automations.update",
    {
      automationId: id,
      definition: def([mail(THEIRS)]),
      expectedVersion: made.automation.version,
      idempotencyKey: "u2",
    },
    alice,
  );
  await assert.rejects(changed, (e) => codeOf(e) === "validation.precondition_failed");
});

test("validate says the same thing for an unsaved definition", async () => {
  const h = world();
  const out = await h.call("automations.validate", { definition: def([mail(MINE)]) }, bob);
  assert.ok(
    out.issues.some(
      (i: { severity: string; message: string; nodeId?: string }) =>
        i.severity === "error" && /you cannot use the mailbox it names/.test(i.message) && i.nodeId === "n1",
    ),
  );
});

test("the class: every step that names an existing file, record, calendar, form or chat is checked at the level its capability asks, from the manifest", async () => {
  const h = harness({ authorize: (_who, a, r) => !(r.id ?? "").startsWith("x_") && a.level !== "never" });
  const cases: [string, Record<string, unknown>, string][] = [
    ["files.move", { fileId: "x_file", toFolderId: "fld_1" }, "file"],
    ["sheet.add_rows", { fileId: "x_sheet", rows: [[1]] }, "file"],
    ["records.update", { type: "contact", recordId: "x_rec", patch: { a: 1 } }, "record"],
    ["calendar.create_event", { calendarId: "x_cal", title: "T", startsAt: 1, endsAt: 2 }, "calendar"],
    ["forms.publish", { formId: "x_form" }, "form"],
    ["sign", { fileId: "x_doc", signers: [{ email: "a@b.c" }] }, "file"],
  ];
  for (const [key, input, word] of cases) {
    const r = await refusal(h, [{ id: "n1", key, input }], alice);
    assert.ok(r, `${key}: the save passed`);
    assert.match(r!.message, new RegExp(`you cannot use the ${word} it names`), `${key}: ${r!.message}`);
    assert.doesNotMatch(r!.message, /x_/);
  }
  // a template, and a thing the person may use, are not refused
  assert.equal(
    await refusal(
      h,
      [{ id: "n1", key: "files.move", input: { fileId: "{{ trigger.fileId }}", toFolderId: "fld_1" } }],
      alice,
    ),
    null,
  );
  assert.equal(
    await refusal(h, [{ id: "n1", key: "files.move", input: { fileId: "fil_ok", toFolderId: "fld_1" } }], alice),
    null,
  );
});

test("every path that writes a definition asks: restoring a version and a Personal copy refuse what the person may not use", async () => {
  let may = true;
  const h = harness({
    authorize: (who, a, r) => (who.id === bob.id && a.level === "view") || (may && fixtureMayUse(who, r)),
  });
  // restore: a version that names a mailbox the restorer may no longer use is not brought back
  const made = await h.call(
    "automations.create",
    create({ definition: def([mail(MINE)]), idempotencyKey: "rv" }),
    alice,
  );
  const id = made.automation.id as string;
  const v1 = (await h.call("automations.versions", { automationId: id }, alice)).versions.find(
    (v: { n: number }) => v.n === 1,
  ).versionId as string;
  await h.call(
    "automations.update",
    { automationId: id, definition: def([sms("num_alice0000001")]), expectedVersion: 1, idempotencyKey: "rv2" },
    alice,
  );
  may = false;
  await assert.rejects(
    h.call("automations.restore_version", { automationId: id, versionId: v1, idempotencyKey: "rv3" }, alice),
    (e) => codeOf(e) === "validation.precondition_failed",
  );
  // a Personal copy of a Space automation naming alice's mailbox is refused for bob
  may = true;
  const space = (
    await h.call("automations.create", create({ definition: def([mail(MINE)]), idempotencyKey: "sp" }), alice)
  ).automation.id as string;
  await h.call("automations.promote", { automationId: space, confirm: true }, alice);
  await assert.rejects(
    h.call("automations.make_personal_copy", { automationId: space }, bob),
    (e) => codeOf(e) === "validation.precondition_failed",
  );
});

test("a check that cannot be made refuses: no access check on the context means no", async () => {
  const { guardAccounts } = await import("../account-use.ts");
  const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" } } as never;
  await assert.rejects(
    guardAccounts(ctx, undefined, def([mail(MINE)]) as never),
    (e) => codeOf(e) === "validation.precondition_failed",
  );
  await assert.rejects(
    guardAccounts(ctx, undefined, def([request("con_shared0000001")]) as never),
    (e) => codeOf(e) === "validation.precondition_failed",
  );
});

test("a connection that is someone's own is theirs: a shared one is every member's, another person's own is refused at save", async () => {
  const h = world();
  assert.ok(await refusal(h, [request("con_alice0000001")], bob), "bob names alice's own connection");
  assert.equal(await refusal(h, [request("con_alice0000001")], alice), null);
  assert.equal(await refusal(h, [request("con_shared0000001")], bob), null);
});
