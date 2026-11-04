// settings.public_of (lane l-agentdm): a teammate's time zone and working hours, only what they set themselves; the shipped default is never handed out as their day, and nothing else of theirs is read.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { handlers } from "../impl.ts";
import type { SettingsCtx } from "../handlers/index.ts";

type Fn = (ctx: SettingsCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: SettingsCtx, input: unknown): Promise<unknown> => (handlers as Record<string, Fn>)[name]!(ctx, input as never);

test("a teammate reads what Maya set, and nothing when she set nothing", async () => {
  const h = harness();
  const maya = h.as("usr_maya");
  const dana = h.as("usr_dana");
  assert.deepEqual(await run("settings.public_of", dana, { personId: "usr_maya" }), {}, "the 9 to 5 UTC default is nobody's real day");
  await run("settings.set", maya, { key: "profile.timezone", value: "Asia/Karachi" });
  await run("settings.set", maya, { key: "profile.working_hours", value: { days: [1, 2, 3, 4, 5], from: "10:00", to: "18:00" } });
  await run("settings.set", maya, { key: "profile.title", value: "Partner" });
  assert.deepEqual(await run("settings.public_of", dana, { personId: "usr_maya" }), { timezone: "Asia/Karachi", hours: { days: [1, 2, 3, 4, 5], from: "10:00", to: "18:00" }, title: "Partner" }, "zone, hours and title; no pronouns until set");
  await run("settings.set", maya, { key: "profile.pronouns", value: "they/them" });
  assert.deepEqual(await run("settings.public_of", dana, { personId: "usr_maya" }), { timezone: "Asia/Karachi", hours: { days: [1, 2, 3, 4, 5], from: "10:00", to: "18:00" }, pronouns: "they/them", title: "Partner" }, "pronouns only when the person set them");
  assert.equal(((await run("settings.public_of", dana, { personId: "usr_maya" })) as { phone?: string }).phone, undefined, "no phone until she sets one for teammates");
  await run("settings.set", maya, { key: "profile.public_phone", value: "+49 30 5550 188" });
  assert.equal(((await run("settings.public_of", dana, { personId: "usr_maya" })) as { phone?: string }).phone, "+49 30 5550 188");
  await assert.rejects(run("settings.public_of", dana, { personId: "agt_intake" }));
});
