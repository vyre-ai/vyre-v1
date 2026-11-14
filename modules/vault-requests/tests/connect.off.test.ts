// The connect card is OFF by default (lib/connect-switch.ts, rc.28; review r-keyreach-9-b-connect). Every connect capability of this module refuses for every caller with one plain message, and the refusal
// reads nothing, writes nothing and emits nothing: the request table is untouched, no capability is called, no event leaves. The plain key request still works with the switch off. This file never turns the switch on.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { world } from "../fixtures/world.ts";
import { CONNECT_OFF_CODE, CONNECT_OFF_MESSAGE, connectCardOn } from "../../../lib/connect-switch.ts";

const CAPS = [
  "vault.connect",
  "vault.connect_card.get",
  "vault.connect_card.options",
  "vault.connect_card.submit",
  "vault.connect_card.ask_admin",
  "vault.connect_card.reopen",
  "vault.connect_card.disconnect",
] as const;
const room = () =>
  world({
    connectors: {
      fathom: { title: "Fathom", scope: "person", fields: [{ name: "api_key", label: "API key", optional: false }] },
    },
    folders: [{ id: "vfd_mine", name: "Mine", scope: "mine" }],
  });
const callers = (w: ReturnType<typeof room>) => ({
  person: w.as("usr_asker", "person"),
  agent: w.as("agt_dex", "agent"),
  "agent acting for a person": w.as("agt_dex", "agent", "usr_asker"),
  "outside actor (a guest)": w.as("act_guest", "actor"),
  service: w.as("svc_host", "service"),
});

test("the switch is off in this suite", () => {
  assert.equal(connectCardOn(), false);
});

for (const cap of CAPS)
  test(`${cap} refuses for every caller with the one plain message and does nothing`, async () => {
    for (const [who, ctx] of Object.entries(callers(room()))) {
      const w = room();
      const c = (callers(w) as Record<string, never>)[who]!;
      const before = JSON.stringify(w.db.all("SELECT * FROM vault_requests_requests"));
      await assert.rejects(
        async () =>
          (handlers[cap] as (c: never, i: never) => Promise<unknown>)(c, {
            service: "Fathom",
            requestId: "vrq_x",
            idempotencyKey: "k",
          } as never),
        (e: { error?: { code?: string; message?: string } }) => {
          assert.equal(e.error?.code, CONNECT_OFF_CODE, who);
          assert.equal(e.error?.message, CONNECT_OFF_MESSAGE, who);
          return true;
        },
        who,
      );
      assert.deepEqual(w.calls, [], `${who}: no capability was called`);
      assert.deepEqual(w.events, [], `${who}: nothing was emitted`);
      assert.equal(
        JSON.stringify(w.db.all("SELECT * FROM vault_requests_requests")),
        before,
        `${who}: nothing was written`,
      );
      void ctx;
    }
  });

test("the plain key request still works with the switch off, for a service's own name too", async () => {
  const w = room();
  const r = (await handlers["vault.request"](w.as("agt_dex", "agent", "usr_asker"), {
    name: "Fathom",
    fields: ["api_key"],
    reason: "To read your meetings.",
    idempotencyKey: "plain-1",
  } as never)) as { request: { state: string; service?: string } };
  assert.equal(r.request.state, "waiting");
  assert.equal(r.request.service, undefined, "a plain request for a service's name is not a connect card");
  assert.equal(w.called("vault.connect_card.get").length, 0);
});
