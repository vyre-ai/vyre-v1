// F47: a step may name only a mailbox, number or connection its saver may use. The check is the product's own (ctx.authorize at Use), run on save as the person saving. A step the saver did not touch is left
// as it is (nothing is migrated), and every refusal names the step.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import { alice, bob, create } from "../fixtures/seed.ts";

const MINE = "mbx_alice0000001";
const THEIRS = "mbx_bob00000001";
const def = (nodes: unknown[]) => ({ triggers: [{ key: "manual" }], nodes, start: [(nodes[0] as { id: string }).id] });
const mail = (mailboxId: string) => ({ id: "n1", key: "send_email", input: { mailboxId, to: ["x@example.com"], subject: "S", body: "B" } });
const sms = (numberId: string) => ({ id: "n1", key: "send_sms", input: { numberId, to: "+15550100", body: "B" } });
const request = (connectionId: string) => ({ id: "n1", key: "connector_request", input: { connector: "acme", action: "list", connectionId } });
const world = () =>
  harness({
    authorize: (who, action, res) =>
      action.level === "use" &&
      ((who.id === "usr_alice" && [MINE, "num_alice0000001", "con_alice0000001"].includes(res.id ?? "")) ||
        (res.id ?? "").startsWith("con_shared")),
  });
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
  const made = await h.call("automations.create", create({ definition: def([mail(MINE)]), idempotencyKey: "own" }), alice);
  const id = made.automation.id as string;
  // alice's colleague (the saver now) renames the automation's other step, leaving the mailbox step as it was: not refused for the step they did not touch
  await h.call("automations.update", { automationId: id, name: "Renamed", idempotencyKey: "u1" }, alice);
  const changed = h.call(
    "automations.update",
    { automationId: id, definition: def([mail(THEIRS)]), expectedVersion: made.automation.version, idempotencyKey: "u2" },
    alice,
  );
  await assert.rejects(changed, (e) => codeOf(e) === "validation.precondition_failed");
});

test("validate says the same thing for an unsaved definition", async () => {
  const h = world();
  const out = await h.call("automations.validate", { definition: def([mail(MINE)]) }, bob);
  assert.ok(out.issues.some((i: { severity: string; message: string; nodeId?: string }) => i.severity === "error" && /you cannot use the mailbox it names/.test(i.message) && i.nodeId === "n1"));
});
