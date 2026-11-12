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

test("a replay of a used, revoked or expired invite says so plainly and mints no code; both codes of a used invite are spent (review Pass 7)", async () => {
  const h = harness();
  const code1 = await create(h, "k3");
  const code2 = await create(h, "k3");
  await handlers["members.accept"](h.anon, { code: code2, ...JOIN });
  await assert.rejects(handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: "k3" }), (e: unknown) => codeOf(e) === "validation.precondition_failed" && /already used/.test(String((e as { message?: string }).message ?? JSON.stringify(e))));
  for (const c of [code1, code2]) await assert.rejects(handlers["members.invites.preview"](h.anon, { code: c }), (e) => codeOf(e) === "auth.invalid_code");
  const rows = h.raw.rows("members_invites").length;
  const late = await create(h, "k4");
  h.advance(8 * 24 * 3_600_000);
  await assert.rejects(handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: "k4" }), (e: unknown) => /expired/.test(String((e as { message?: string }).message ?? JSON.stringify(e))));
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code: late }), (e) => codeOf(e) === "auth.expired");
  assert.equal(h.raw.rows("members_invites").length, rows + 1, "nothing new was made");
});

test("a replay of a revoked invite says it was revoked and mints no code (Pass 9)", async () => {
  const h = harness();
  const code1 = await create(h, "k5");
  await create(h, "k5");
  await handlers["members.invites.revoke"](h.as("usr_admin"), { inviteId: seamId(h, code1) });
  const rows = JSON.stringify(h.raw.rows("members_invites"));
  await assert.rejects(handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: "k5" }), (e: unknown) => codeOf(e) === "validation.precondition_failed" && /was revoked/.test(String((e as { message?: string }).message ?? JSON.stringify(e))));
  assert.equal(JSON.stringify(h.raw.rows("members_invites")), rows, "nothing changed: no fresh code");
});
