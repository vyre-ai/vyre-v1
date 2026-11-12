// A create replayed with the same idempotencyKey (a slow answer and a retry) hands out a fresh code; the code the owner already sent must keep working (12 Nov 2026: "This invite did not open").
// Revoke and use still end every code of the invite.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, invitesSeam } from "../impl.ts";
import { codeOf, harness, KEYS } from "../fixtures/db.ts";

const JOIN = { username: "dana", displayName: "Dana", password: "a long enough password", deviceName: "Dana's Mac", deviceClass: "desktop" as const, keys: KEYS };
const codeFrom = (link: string): string => /\/join\/([A-Z0-9-]+)#/.exec(link)![1]!;
const create = async (h: ReturnType<typeof harness>, key = "k1") => codeFrom((await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: key })).link);

test("a replayed create keeps the code already handed out: preview and accept with it still work", async () => {
  const h = harness();
  const code1 = await create(h);
  const code2 = await create(h);
  assert.notEqual(code1, code2, "the replay answers a fresh code (only hashes are kept)");
  assert.equal((await handlers["members.invites.preview"](h.anon, { code: code1 })).spaceName, "Maya Studio", "the first link still opens");
  assert.equal((await handlers["members.invites.preview"](h.anon, { code: code2 })).spaceName, "Maya Studio");
  const seam = invitesSeam(h.as("usr_admin"));
  const a = seam.peek(code1), b = seam.peek(code2);
  assert.ok(typeof a === "object" && typeof b === "object" && a.inviteId === b.inviteId, "both codes are the one invite");
  await handlers["members.accept"](h.anon, { code: code1, ...JOIN });
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code: code2 }), (e) => codeOf(e) === "auth.invalid_code", "used: every code of it is spent");
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code: code1 }), (e) => codeOf(e) === "auth.invalid_code");
});

test("revoking ends the earlier code too", async () => {
  const h = harness();
  const code1 = await create(h, "k2");
  await create(h, "k2");
  const id = (seamId(h, code1));
  await handlers["members.invites.revoke"](h.as("usr_admin"), { inviteId: id });
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code: code1 }), (e) => codeOf(e) === "auth.invalid_code");
});

function seamId(h: ReturnType<typeof harness>, code: string): string {
  const p = invitesSeam(h.as("usr_admin")).peek(code);
  assert.ok(typeof p === "object");
  return p.inviteId;
}
