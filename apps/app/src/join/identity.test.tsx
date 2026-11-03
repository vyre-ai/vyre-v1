// One Vyre account across Spaces (rc.14): owning or joining a Space with the account this device already has carries the same person key, the same wraps and the same key pair, opened
// with the current password; "Use a different account" leads to today's form; with no account on the device the form says it makes one; a new recovery code retires the old one.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { carryBundle, makeBundle, openBundle, openSpaceKey, openWithRecovery } from "../../../../client/src/crypto/keys.ts";
import type { ArgonParams, MadeBundle } from "../../../../client/src/crypto/keys.ts";
import { claimOwner } from "../claim/claim.ts";
import { ClaimOwner, NEW_ACCOUNT } from "../claim/ClaimOwner.tsx";
import { ClaimRoute } from "../claim/ClaimRoute.tsx";
import { makeNewRecoveryCode } from "../places/settings/security.ts";
import { acceptDesktopJoin, routeDesktopLink } from "../shell/session/desktop.ts";
import { claimAppLink } from "../shell/session/entry.ts";
import type { StoredSession } from "../shell/session/stored.ts";
import { find, flush, installDom, mount, press, textOf } from "../onboarding/test-dom.ts";
import { CARRY_LINE, CarryError, carryIdentity, knownIdentity } from "./identity.ts";

const FAST: ArgonParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };
const PASSWORD = "correct horse battery";
const CODE = "K7QM-4TXD-9WPA-H3NE";
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const def = (spaceId: string, name: string, kind: "personal" | "team") => ({ spaceId, name, kind, kit: "general", skinDefault: "paper", tint: ["#000", "#fff"], counts: {}, dots: {} });
const session = (baseUrl: string, spaceId: string, name: string, kind: "personal" | "team", username?: string): StoredSession =>
  ({ baseUrl, token: `tok_${spaceId}`, personId: "usr_irfad", marker: "m", ...(username ? { username } : {}), displayName: "Irfad Imtiaz", def: def(spaceId, name, kind) }) as unknown as StoredSession;

/** The Personal Space's account: a real bundle, as the person made it on this Mac, and the key it wraps. */
async function personal(): Promise<{ made: MadeBundle; keys: { personKeyByPassword: string; personKeyByRecovery: string; publicKey: string; privateKeyWrapped: string } }> {
  const made = await makeBundle(PASSWORD, CODE, { argon: FAST, spaceId: "spc_personal" });
  return { made, keys: { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped } };
}
const sourceOf = (keys: unknown) => async (cap: string): Promise<unknown> => { assert.equal(cap, "identity.keys_get"); return { keys }; };
const carry = (keys: unknown) => (password: string, spaceId: string) => carryIdentity({ source: sourceOf(keys), carryBundle: (p, b, s) => carryBundle(p, b, s, { argon: FAST }) }, password, spaceId);

test("the known account: the Personal Space's, never the Space being set up, and a provider sign-in last", () => {
  const mine = session("http://127.0.0.1:7801", "spc_personal", "Personal", "personal", "irfad");
  const team = session("https://acme.example", "spc_acme", "Acme", "team", "irfad.i");
  assert.equal(knownIdentity([team, mine])?.spaceId, "spc_personal", "the Personal Space first");
  assert.equal(knownIdentity([team, mine], { spaceId: "spc_personal" })?.spaceId, "spc_acme");
  assert.equal(knownIdentity([mine], { baseUrl: "http://127.0.0.1:7801" }), null);
  // rc.17: a session from a Google, Microsoft or GitHub sign-in has no username; it is offered after any whose password this device has seen
  const sso = session("https://x.example", "spc_x", "X", "team");
  assert.deepEqual(knownIdentity([sso]), { name: "Irfad Imtiaz", baseUrl: "https://x.example", token: "tok_spc_x", spaceId: "spc_x", spaceName: "X", provider: true });
  assert.equal(knownIdentity([sso, team])?.spaceId, "spc_acme", "an account opened with its password comes first");
  assert.deepEqual(knownIdentity([mine]), { username: "irfad", name: "Irfad Imtiaz", baseUrl: "http://127.0.0.1:7801", token: "tok_spc_personal", spaceId: "spc_personal", spaceName: "Personal" });
});

test("claim with the existing account: the same person key and wraps, a Space key for the new Space, and no new recovery code", async () => {
  const { made, keys } = await personal();
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const held: Uint8Array[] = [];
  const out = await claimOwner({
    call: async (cap, input) => { calls.push({ cap, input: input as Record<string, unknown> }); return { status: "ok", session: { token: "vst_owner" }, principal: { id: "usr_owner" } }; },
    makeBundle: (pw, _code, id) => carry(keys)(pw, id),
    holdKey: async (_t, key) => { held.push(new Uint8Array(key)); return false; },
    wipe: (b) => b.fill(0),
  }, { token: "clm_abcdefgh", spaceId: "spc_mla", name: "Irfad Imtiaz", username: "irfad", password: PASSWORD, recoveryCode: "", deviceName: "Vyre desktop", deviceClass: "desktop" });
  assert.equal(out.token, "vst_owner");
  const sent = calls[0]!.input;
  assert.equal(calls[0]!.cap, "identity.claim_owner");
  assert.equal(sent["username"], "irfad");
  assert.equal(sent["password"], PASSWORD, "the same password signs in to the new Space");
  const k = sent["keys"] as { personKeyByPassword: string; personKeyByRecovery: string; publicKey: string; privateKeyWrapped: string; spaceKeys: { epoch: number; wrapped: string }[] };
  assert.equal(k.personKeyByPassword, keys.personKeyByPassword);
  assert.equal(k.personKeyByRecovery, keys.personKeyByRecovery, "the recovery wrap is carried: no new recovery code");
  assert.equal(k.publicKey, keys.publicKey);
  assert.equal(k.privateKeyWrapped, keys.privateKeyWrapped);
  const opened = await openBundle(PASSWORD, k, { argon: FAST });
  assert.ok(same(opened.personKey, made.personKey), "the same person key");
  assert.ok(same((await openWithRecovery(CODE, k, { argon: FAST })).personKey, made.personKey), "the recovery code the person already kept opens it");
  assert.equal(k.spaceKeys.length, 1);
  assert.equal((await openSpaceKey(opened.privateKey, k.spaceKeys[0]!, "spc_mla")).length, 32, "the new Space key is sealed to the same key pair, for this Space");
  await assert.rejects(openSpaceKey(opened.privateKey, k.spaceKeys[0]!, "spc_personal"), "and only for this Space");
  assert.equal(held.length, 1);
});

test("claim with the existing account: a wrong password is one plain line and nothing is sent", async () => {
  const { keys } = await personal();
  let called = false;
  await assert.rejects(claimOwner({ call: async () => { called = true; return {}; }, makeBundle: (pw, _c, id) => carry(keys)(pw, id), holdKey: async () => false, wipe: () => undefined },
    { token: "clm_abcdefgh", spaceId: "spc_mla", name: "I", username: "irfad", password: "wrong password", recoveryCode: "", deviceName: "d" }),
    (e: unknown) => e instanceof CarryError && e.failure === "password" && e.line === CARRY_LINE.password);
  assert.equal(called, false);
  await assert.rejects(carryIdentity({ source: async () => { throw new TypeError("Failed to fetch"); }, carryBundle: async () => { throw new Error("not reached"); } }, PASSWORD, "spc_mla"), (e: unknown) => e instanceof CarryError && e.failure === "unreachable");
});

test("join with the existing account: members.accept gets the same wraps and key pair, and a carried account with no recovery code stays without one", async () => {
  const { made, keys } = await personal();
  const { personKeyByRecovery: _none, ...noRecovery } = keys;
  for (const [bundle, keepsRecovery] of [[keys, true], [noRecovery, false]] as const) {
    const accepted: Record<string, unknown>[] = [];
    const persisted: StoredSession[] = [];
    const stored = await acceptDesktopJoin(
      { route: { kind: "join", address: "https://acme.example", code: "AB12-CD34", fingerprint: "9f3c" }, preview: { spaceId: "spc_acme", spaceName: "Acme", invitedBy: "Maya", role: "member", expiresAt: 1, fingerprint: "9f3c" } },
      { username: "irfad", displayName: "Irfad Imtiaz", password: PASSWORD, deviceName: "Vyre desktop", trustDevice: true, ai: { choice: "none" } },
      {
        anonymous: async (cap, input) => { assert.equal(cap, "members.accept"); accepted.push(input as Record<string, unknown>); return { token: "vst_member" }; },
        open: async () => ({ def: { spaceId: "spc_acme" }, me: { id: "usr_member" }, close: () => undefined }),
        getSpace: async () => ({ id: "spc_acme", marker: "acme" }),
        persist: (s) => persisted.push(s),
        carry: (spaceId) => carry(bundle)(PASSWORD, spaceId),
      },
    );
    assert.equal(stored.def.spaceId, "spc_acme");
    assert.equal(persisted.length, 1, "the Space is stored, so the switcher lists it");
    const k = accepted[0]!["keys"] as Record<string, unknown> & { spaceKeys: { epoch: number; wrapped: string }[] };
    assert.equal(accepted[0]!["username"], "irfad");
    assert.equal(k["personKeyByPassword"], keys.personKeyByPassword);
    assert.equal(k["publicKey"], keys.publicKey);
    assert.equal(k["privateKeyWrapped"], keys.privateKeyWrapped);
    assert.equal("personKeyByRecovery" in k, keepsRecovery);
    if (keepsRecovery) assert.equal(k["personKeyByRecovery"], keys.personKeyByRecovery);
    const opened = await openBundle(PASSWORD, { ...k, personKeyByRecovery: "" } as never, { argon: FAST });
    assert.ok(same(opened.personKey, made.personKey));
    assert.equal((await openSpaceKey(opened.privateKey, k.spaceKeys[0]!, "spc_acme")).length, 32);
  }
});

test("claim screen: with an account on this device it opens on Continue as, asking only for the password; Use a different account leads to today's form", async () => {
  installDom();
  const tried: string[] = [];
  const root = await mount(createRoot, <ClaimOwner space="MLA" newCode={() => CODE} onClaim={async () => undefined} known={{ username: "irfad", name: "Irfad Imtiaz" }} onClaimAs={async (pw) => { tried.push(pw); throw new CarryError("password", CARRY_LINE.password); }} />);
  assert.match(textOf(root as never), /Continue as irfad/);
  assert.ok(find(root as never, "claim-as-password"));
  assert.equal(find(root as never, "claim-name"), null, "no name, username or new password");
  assert.equal(find(root as never, "claim-confirm"), null);
  assert.equal(find(root as never, "claim-as")!.props["aria-disabled"], true, "Continue waits for the password");
  const field = find(root as never, "claim-as-password")!;
  await (await import("react")).act(async () => { (field.props["onChange"] as (e: unknown) => void)({ target: { value: "nope" }, nativeEvent: { text: "nope" } }); });
  await press(find(root as never, "claim-as"));
  await flush();
  assert.deepEqual(tried, ["nope"]);
  assert.equal(textOf(find(root as never, "claim-as-error")), CARRY_LINE.password);
  await press(find(root as never, "claim-as-other"));
  await flush();
  for (const id of ["claim-name", "claim-username", "claim-password", "claim-confirm"]) assert.ok(find(root as never, id), id);
  assert.match(textOf(root as never), new RegExp(NEW_ACCOUNT));
  await press(find(root as never, "back"));
  await flush();
  assert.ok(find(root as never, "claim-as-password"), "Back returns to Continue as");
});

test("claim screen: with no account on this device it is today's form, which says it makes the Vyre account for every Space", () => {
  const out = renderToStaticMarkup(<ClaimOwner space="MLA" newCode={() => CODE} onClaim={async () => undefined} />);
  assert.ok(out.includes('data-testid="claim-name"'));
  assert.ok(!out.includes("claim-as"));
  assert.ok(out.includes(NEW_ACCOUNT));
});

const withStored = (sessions: Record<string, unknown>, run: () => void): void => {
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  const data = new Map([["vyre.session.v1", JSON.stringify({ sessions })]]);
  g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  try { run(); } finally { g.localStorage = had; }
};

test("claim route: the account signed in on this device is offered; none in a fresh browser", () => {
  const mine = session("http://127.0.0.1:7801", "spc_personal", "Personal", "personal", "irfad");
  const route = (): string => renderToStaticMarkup(<ClaimRoute token="clm_abcdefgh" address="https://mla.example" fragment="#s=spc_mla&n=MLA" onDone={() => undefined} onSignIn={() => undefined} deviceClass="desktop" />);
  withStored({ [mine.baseUrl]: mine }, () => assert.ok(route().includes("Continue as irfad")));
  withStored({}, () => { const out = route(); assert.ok(out.includes('data-testid="claim-name"')); assert.ok(!out.includes("Continue as")); });
});

test("a claim link in a browser can hand off to the desktop app, which routes it to its own claim", () => {
  const link = claimAppLink("https://mla.example", "clm_abcdefgh", "#fp=9f3c1a2b&s=spc_mla&n=MLA%20Team");
  assert.equal(link, "vyre://claim?address=https%3A%2F%2Fmla.example&token=clm_abcdefgh&s=spc_mla&fp=9f3c1a2b&n=MLA+Team");
  assert.equal(claimAppLink("http://127.0.0.1:7801", "clm_abcdefgh", "#s=spc_mla"), null, "a Space on this computer is claimed here already");
  assert.equal(claimAppLink("https://irfad.vyre.run", "clm_abcdefgh", "#s=spc_mla"), null, "not a phone address");
  const params = Object.fromEntries(new URL(link!).searchParams);
  const route = routeDesktopLink({ action: "claim", params });
  assert.deepEqual(route, { kind: "claim", address: "https://mla.example", token: "clm_abcdefgh", fragment: "#s=spc_mla&fp=9f3c1a2b&n=MLA+Team" });
  assert.equal(routeDesktopLink({ action: "claim", params: { ...params, address: "http://mla.example" } }), null, "HTTPS only");
  assert.equal(routeDesktopLink({ action: "claim", params: { ...params, token: "x" } }), null);
});

test("a new recovery code: the old code stops working, the new one works, in every Space with this account", async () => {
  const { made, keys } = await personal();
  const stores: Record<string, Record<string, unknown>> = { here: { ...keys, spaceKeys: [] }, mla: { ...keys, spaceKeys: [] }, other: { ...keys, publicKey: "b3RoZXI=", spaceKeys: [] } };
  const callOf = (name: string) => async (cap: string, input: unknown): Promise<unknown> => {
    if (name === "down") throw new TypeError("Failed to fetch");
    if (cap === "identity.keys_get") return { keys: stores[name] };
    if (cap === "identity.recovery_save") { stores[name] = { ...stores[name], personKeyByRecovery: (input as { personKeyByRecovery: string }).personKeyByRecovery }; return { ok: true }; }
    throw new Error(cap);
  };
  const NEW = "Q2WE-R3TY-U4PA-S5DF";
  await assert.rejects(makeNewRecoveryCode(callOf("here"), "wrong password", NEW, [], "Personal", { argon: FAST }), "a wrong password changes nothing");
  assert.equal(stores["here"]!["personKeyByRecovery"], keys.personKeyByRecovery);
  const out = await makeNewRecoveryCode(callOf("here"), PASSWORD, NEW, [{ name: "MLA", call: callOf("mla") }, { name: "Elsewhere", call: callOf("other") }, { name: "Offline", call: callOf("down") }], "Personal", { argon: FAST });
  assert.deepEqual(out, { updated: ["Personal", "MLA"], missed: ["Offline"] });
  for (const name of ["here", "mla"]) {
    const bundle = { ...stores[name]!, personKeyByPassword: keys.personKeyByPassword } as never;
    await assert.rejects(openWithRecovery(CODE, bundle, { argon: FAST }), "the old code no longer opens it");
    assert.ok(same((await openWithRecovery(NEW, bundle, { argon: FAST })).personKey, made.personKey), "the new code opens the same person key");
  }
  assert.equal(stores["other"]!["personKeyByRecovery"], keys.personKeyByRecovery, "a different account elsewhere keeps its own code");
});
