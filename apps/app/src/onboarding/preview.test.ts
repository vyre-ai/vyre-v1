import test from "node:test";
import assert from "node:assert/strict";
import { previewFor } from "./preview.ts";
import type { CapCall } from "../shell/session/caps.ts";

const fake = (answers: Record<string, unknown>): CapCall => (async (c: string) => { if (!(c in answers)) throw new Error("none"); return answers[c]; }) as unknown as CapCall;

test("the preview shows the AI account as a chip in the Vault, and Not yet when there is none", async () => {
  const p = await previewFor(fake({ "providers.list": { providers: [{ id: "p1", name: "Claude", connection: "subscription", scope: "mine" }] } }), "connect_ai");
  assert.deepEqual(p.items.map((i) => i.label), ["Claude · subscription · in your Vault"]);
  const none = await previewFor(fake({ "providers.list": { providers: [] } }), "connect_ai");
  assert.equal(none.items.length, 0);
  assert.match(none.hint, /^Not yet\./);
});

test("the preview lists only the facts saved from the interview, and the paired devices", async () => {
  const f = await previewFor(fake({ "memory.facts.list": { facts: [{ factId: "a", text: "Works as: ops", sourceRef: "onboarding", status: "current" }, { factId: "b", text: "Other", sourceRef: "chat" }, { factId: "c", text: "Gone", sourceRef: "onboarding", status: "removed" }] } }), "interview");
  assert.deepEqual(f.items.map((i) => i.label), ["Works as: ops"]);
  const d = await previewFor(fake({ "devices.list": { devices: [{ id: "1", name: "Mac", class: "desktop", current: true }, { id: "2", name: "Old", class: "phone", revokedAt: 5 }] } }), "phone");
  assert.deepEqual(d.items.map((i) => [i.label, i.note]), [["Mac", "desktop, this one"]]);
});

test("the team list grows with people and open invites; agents show without the assistant; the Kit shows once installed", async () => {
  const t = await previewFor(fake({ "access.principals.list": { principals: [{ id: "u", name: "Dana", status: "active" }, { id: "x", name: "Gone", status: "removed" }] }, "members.invites.list": { invites: [{ id: "i1", email: "o@x.y", state: "open" }, { id: "i2", state: "accepted" }] } }), "invites");
  assert.deepEqual(t.items.map((i) => i.label), ["Dana", "o@x.y"]);
  const a = await previewFor(fake({ "agents.list": { agents: [{ agentId: "1", name: "Dana Assistant", role: "assistant" }, { agentId: "2", name: "Intake", role: "Answers" }] } }), "agents");
  assert.deepEqual(a.items.map((i) => i.label), ["Intake"]);
  const k = await previewFor(fake({ "kits.list": { kits: [{ kitId: "k", title: "Studio", installed: true }, { kitId: "j", title: "Blank", installed: false }] } }), "org");
  assert.deepEqual(k.items.map((i) => i.label), ["Studio"]);
  assert.equal((await previewFor(fake({}), "agents")).items.length, 0, "a failed read is an empty preview, not an error");
});
