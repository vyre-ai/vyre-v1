// A person leaving reaches every module that holds their mail: the host has to collect each consumer, or the export does nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { collectHooks } from "../host/src/daemon/consumers.ts";
import * as mail from "../modules/mail/impl.ts";
import * as google from "../modules/google/impl.ts";
import * as microsoft from "../modules/microsoft/impl.ts";

test("the host runs all three: a person leaving reaches mail and both sign-in modules", () => {
  for (const [id, name, ns] of [["mail", "mail.person_left", mail], ["google", "google.person_left", google], ["microsoft", "ms.person_left", microsoft]] as const) {
    assert.deepEqual(collectHooks(id, ns as Record<string, unknown>).consumers.find((c) => c.name === name)?.on, ["member.removed"], name);
  }
});
