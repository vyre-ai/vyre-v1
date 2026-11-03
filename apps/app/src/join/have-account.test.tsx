// rc.17: "I already have a Vyre account", "Continue as" for a person known from a provider sign-in, and Settings > Use one account everywhere, as screens and as the logic behind them.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { carryBundle, carryWithRecovery, heldKeyOf, makeBundle, openBundle, openWithRecovery } from "../../../../client/src/crypto/keys.ts";
import type { ArgonParams, RecoveryBundle } from "../../../../client/src/crypto/keys.ts";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../onboarding/test-dom.ts";
import { ContinueAs } from "./ContinueAs.tsx";
import { HaveAccount } from "./HaveAccount.tsx";
import type { HaveAccountDeps } from "./HaveAccount.tsx";
import { CarryError, carriedOf, cleanCode, isRecoveryCode, recoveryAtHome, signInHome } from "./identity.ts";
import type { HomeDeps, Proof } from "./identity.ts";
import { ClaimOwner } from "../claim/ClaimOwner.tsx";
import { LinkSheet } from "../places/settings/LinkSheet.tsx";
import { linkAccounts } from "../places/settings/security.ts";

const FAST: ArgonParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };
const crypto = { carryBundle: (p: string, b: never, id: string) => carryBundle(p, b, id, { argon: FAST }), carryWithRecovery: (c: string, p: string, b: RecoveryBundle, id: string) => carryWithRecovery(c, p, b, id, { argon: FAST }) };
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const CODE = "K7QM-4TXD-9WPA-H3NE";

test("a recovery code is recognised in any case and spacing, and a password is not", () => {
  for (const c of [CODE, "k7qm4txd9wpah3ne", " K7QM 4TXD 9WPA H3NE "]) assert.ok(isRecoveryCode(c), c);
  for (const p of ["correct horse battery", "K7QM-4TXD", "password123456789"]) assert.ok(!isRecoveryCode(p), p);
  assert.equal(cleanCode("k7qm4txd9wpah3ne"), CODE);
});

test("sign-in at the home Space: the bundle and name come back, the session there is ended, and wrong details, a second factor and an outage read as one line each", async () => {
  const keys = { personKeyByPassword: "cHc=", personKeyByRecovery: "cmM=", publicKey: "cHVi", privateKeyWrapped: "cHJpdg==", spaceKeys: [] };
  const calls: string[] = [];
  const deps = (answer: (cap: string, input: Record<string, unknown>) => unknown): HomeDeps => ({
    anonymous: () => async (cap, input) => { calls.push(`anon ${cap}`); return answer(cap, input as Record<string, unknown>); },
    signedIn: (_a, token) => async (cap) => { calls.push(`${token} ${cap}`); return cap === "identity.whoami" ? { name: "Dana Wills" } : { ok: true }; },
    device: { deviceName: "Browser", deviceClass: "web" },
  });
  const got = await signInHome(deps((cap, i) => { assert.equal(cap, "identity.sign_in"); assert.equal(i["username"], "dana"); return { status: "ok", session: { token: "vst_a" }, keys }; }), "https://a.example", " Dana ", "pw");
  assert.deepEqual(got, { username: "dana", name: "Dana Wills", bundle: keys });
  assert.deepEqual(calls, ["anon identity.sign_in", "vst_a identity.whoami", "vst_a identity.sign_out"], "signed out at the home Space at once");
  assert.equal(await signInHome(deps(() => ({ status: "second_factor_required" })), "https://a.example", "dana", "pw"), "second_factor");
  const fail = (code: string) => deps(() => { throw Object.assign(new Error("no"), { code }); });
  await assert.rejects(signInHome(fail("auth.bad_credentials"), "https://a.example", "dana", "x"), (e) => e instanceof CarryError && e.failure === "signin");
  await assert.rejects(signInHome(fail("auth.invalid_code"), "https://a.example", "dana", "x", "123456"), (e) => e instanceof CarryError && e.failure === "second_factor");
  await assert.rejects(signInHome(deps(() => { throw new TypeError("Failed to fetch"); }), "https://a.example", "dana", "x"), (e) => e instanceof CarryError && e.failure === "unreachable");
  const rec = await recoveryAtHome(deps(() => ({ keys: { personKeyByRecovery: "cmM=", publicKey: "cHVi", privateKeyWrapped: "cHJpdg==", spaceKeys: [] }, challenge: {}, context: "c" })), "https://a.example", "dana");
  assert.deepEqual(rec, { personKeyByRecovery: "cmM=", publicKey: "cHVi", privateKeyWrapped: "cHJpdg==" }, "only the recovery part is kept");
});

test("a recovery-code proof carries the same person key under a password chosen now; a password proof keeps the account's own password", async () => {
  const home = await makeBundle("forgotten", CODE, { argon: FAST, spaceId: "spc_a" });
  const byCode: Proof = { kind: "code", username: "rubab", name: "Rubab", code: "k7qm 4txd 9wpa h3ne", newPassword: "chosen now please", bundle: { personKeyByRecovery: home.personKeyByRecovery, publicKey: home.publicKey, privateKeyWrapped: home.privateKeyWrapped } };
  const c = carriedOf(byCode, crypto);
  assert.equal(c.password, "chosen now please");
  assert.equal(c.viaPassword, undefined);
  const made = await c.carry("spc_b");
  assert.ok(same(made.personKey, home.personKey));
  assert.ok(same((await openBundle("chosen now please", made, { argon: FAST })).personKey, home.personKey));
  await assert.rejects(carriedOf({ ...byCode, code: "WRNG-4TXD-9WPA-H3NE" }, crypto).carry("spc_b"), (e) => e instanceof CarryError && e.failure === "code");
  const byPw = carriedOf({ kind: "password", username: "rubab", name: "Rubab", password: "forgotten", bundle: home }, crypto);
  assert.equal(byPw.viaPassword, true);
  assert.equal((await byPw.carry("spc_b")).personKeyByPassword, home.personKeyByPassword, "the same password wrap");
});

function fakeDeps(over: Partial<HaveAccountDeps> = {}): HaveAccountDeps & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    options: async (a) => { log.push(`options ${a}`); return { name: "Northwind", password: true, sso: [], address: "https://northwind.example" }; },
    signIn: async (_a, u, p, t) => { log.push(`signin ${u} ${p}${t ? ` ${t}` : ""}`); return { username: u, name: "Dana Wills", bundle: { personKeyByPassword: "cHc=", publicKey: "cHVi", privateKeyWrapped: "cHJpdg==" } }; },
    recovery: async (_a, u) => { log.push(`recovery ${u}`); return { personKeyByRecovery: "cmM=", publicKey: "cHVi", privateKeyWrapped: "cHJpdg==" }; },
    checkCode: async (code) => { log.push(`check ${code}`); if (code.startsWith("WRNG")) throw new CarryError("code", "That recovery code is not right."); },
    ...over,
  };
}

test("I already have a Vyre account: the address, then the username and password there; the proof goes to the join", async () => {
  installDom();
  const deps = fakeDeps();
  const proofs: Proof[] = [];
  const root = await mount(createRoot, <HaveAccount prefix="join-have" space="Beacon" working="Joining Beacon" deps={deps} onProof={async (p) => { proofs.push(p); }} onBack={() => undefined} />);
  assert.match(textOf(root as never), /Use your Vyre account/);
  assert.match(textOf(root as never), /same password and recovery code/);
  await typeInto(find(root as never, "join-have-address"), "northwind.example");
  await press(find(root as never, "join-have-next"));
  await flush();
  assert.match(textOf(root as never), /Sign in to Northwind/);
  await typeInto(find(root as never, "join-have-username"), "dana");
  await typeInto(find(root as never, "join-have-password-field"), "her password");
  await press(find(root as never, "join-have-next"));
  await flush();
  assert.deepEqual(deps.log, ["options northwind.example", "signin dana her password"]);
  assert.equal(proofs.length, 1);
  assert.deepEqual({ kind: proofs[0]!.kind, username: proofs[0]!.username, name: proofs[0]!.name }, { kind: "password", username: "dana", name: "Dana Wills" });
});

test("I already have a Vyre account at a Space that uses Google: the recovery code, a wrong one said at once, then a password chosen once", async () => {
  installDom();
  const deps = fakeDeps({ options: async () => ({ name: "Firm", password: false, sso: [{ key: "google", title: "Google" }], address: "https://firm.example" }) });
  const proofs: Proof[] = [];
  const root = await mount(createRoot, <HaveAccount prefix="claim-have" space="Beacon" working="Setting up Beacon" deps={deps} onProof={async (p) => { proofs.push(p); }} onBack={() => undefined} />);
  await typeInto(find(root as never, "claim-have-address"), "firm.example");
  await press(find(root as never, "claim-have-next"));
  await flush();
  assert.match(textOf(root as never), /Firm signs you in with Google/);
  assert.equal(find(root as never, "claim-have-password-field"), null, "no password field: that Space does not take one");
  await typeInto(find(root as never, "claim-have-username"), "rubab");
  await typeInto(find(root as never, "claim-have-code-field"), "WRNG-4TXD-9WPA-H3NE");
  await press(find(root as never, "claim-have-next"));
  await flush();
  assert.equal(textOf(find(root as never, "claim-have-error")), "Check the username and recovery code.");
  await typeInto(find(root as never, "claim-have-code-field"), CODE);
  await press(find(root as never, "claim-have-next"));
  await flush();
  assert.match(textOf(root as never), /Choose your Vyre password/);
  assert.match(textOf(root as never), /Your recovery code stays the same/);
  await typeInto(find(root as never, "claim-have-new-password"), "chosen now please");
  await typeInto(find(root as never, "claim-have-confirm"), "chosen now please");
  await press(find(root as never, "claim-have-next"));
  await flush();
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0]!.kind, "code");
  assert.equal((proofs[0] as Extract<Proof, { kind: "code" }>).newPassword, "chosen now please");
});

test("Continue as a person known from Google: one field takes the password or the recovery code; a code is checked, then a password is chosen", async () => {
  installDom();
  const said: string[] = [];
  const root = await mount(createRoot, <ContinueAs prefix="join-as" space="Beacon" username="Rubab" sub="Your Vyre password (the one you set when you joined), or your recovery code, to join Beacon" working="Joining Beacon"
    onContinue={async (pw) => { said.push(`password ${pw}`); }} onOther={() => undefined}
    either={{ onCheckCode: async (c) => { said.push(`check ${c}`); }, onRecovery: async (c, pw) => { said.push(`recover ${c} ${pw}`); } }} />);
  assert.match(textOf(root as never), /Password or recovery code/);
  assert.match(textOf(root as never), /asked once on this device/);
  await typeInto(find(root as never, "join-as-password"), "k7qm4txd9wpah3ne");
  await press(find(root as never, "join-as"));
  await flush();
  assert.match(textOf(root as never), /Choose your Vyre password/);
  await typeInto(find(root as never, "join-as-new-password"), "chosen now please");
  await typeInto(find(root as never, "join-as-confirm"), "chosen now please");
  await press(find(root as never, "join-as-newpass-next"));
  await flush();
  assert.deepEqual(said, [`check ${CODE}`, `recover ${CODE} chosen now please`]);
  // a password goes straight through
  const r2 = await mount(createRoot, <ContinueAs prefix="claim-as" space="Beacon" username="Rubab" sub="s" working="w" onContinue={async (pw) => { said.push(`password ${pw}`); }} onOther={() => undefined} either={{ onCheckCode: async () => undefined, onRecovery: async () => undefined }} />);
  await typeInto(find(r2 as never, "claim-as-password"), "the one from joining");
  await press(find(r2 as never, "claim-as"));
  await flush();
  assert.equal(said.at(-1), "password the one from joining");
});

test("the claim form and the invite form offer I already have a Vyre account; the claim form says a new account only on the form that makes one", () => {
  const claim = renderToStaticMarkup(<ClaimOwner space="Beacon" newCode={() => CODE} onClaim={async () => undefined} onHaveAccount={() => undefined} />);
  assert.ok(claim.includes('data-testid="claim-have-account"'));
  assert.ok(claim.includes("I already have a Vyre account"));
  const known = renderToStaticMarkup(<ClaimOwner space="Beacon" newCode={() => CODE} onClaim={async () => undefined} known={{ username: "Rubab", name: "Rubab", provider: true }} onClaimAs={async () => undefined} either={{ onCheckCode: async () => undefined, onRecovery: async () => undefined }} />);
  assert.ok(known.includes("Password or recovery code"));
  assert.ok(!known.includes("creates your Vyre account"), "no new-account words when an account exists");
});

test("Use one account everywhere: the sheet offers the two accounts; the link sends the kept username and password, the proof, and a bundle the kept password opens with the other Space's data key", async () => {
  const kept = await makeBundle("kept password", "KEPT-CODE-AAAA-BBBB", { argon: FAST, spaceId: "spc_personal" });
  const other = await makeBundle("other password", "OTHR-CODE-AAAA-BBBB", { argon: FAST, spaceId: "spc_mla" });
  const wire = (b: typeof kept) => ({ personKeyByPassword: b.personKeyByPassword, personKeyByRecovery: b.personKeyByRecovery, publicKey: b.publicKey, privateKeyWrapped: b.privateKeyWrapped, spaceKeys: b.spaceKeys ?? [] });
  const sent: Record<string, unknown>[] = [];
  const keepCall = async (cap: string): Promise<unknown> => cap === "identity.keys_get" ? { keys: wire(kept) } : { username: "irfad" };
  const otherCall = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "identity.keys_get") return { keys: wire(other) };
    if (cap === "identity.security.get") return { username: "irfad.mla" };
    if (cap === "identity.link_account") { sent.push(input as Record<string, unknown>); return { status: "ok", session: { token: "vst_new" } }; }
    throw new Error(cap);
  };
  const sides = [{ name: "Personal", spaceId: "spc_personal", call: keepCall, username: "irfad", publicKey: kept.publicKey }, { name: "MLA", spaceId: "spc_mla", call: otherCall, username: "irfad.mla", publicKey: other.publicKey }];
  installDom();
  const sheetText = async (el: Parameters<typeof mount>[1]): Promise<string> => textOf(await mount(createRoot, el) as never);
  const html = await sheetText(<LinkSheet spaces={[]} device={{ deviceName: "Mac", deviceClass: "desktop" }} onSession={() => undefined} onClose={() => undefined} initial={{ sides, keep: "spc_personal" }} />);
  for (const t of ["Use one account everywhere", "Your account in Personal", "Your account in MLA", "Password for irfad", "Password or recovery code for irfad.mla in MLA", "MLA will sign you in as irfad"]) assert.ok(html.includes(t), t);
  const stored: string[] = [];
  await linkAccounts(sides[0]!, "kept password", sides[1]!, "other password", { deviceName: "Mac", deviceClass: "desktop" }, (id, token, username) => stored.push(`${id} ${token} ${username}`), { argon: FAST });
  assert.deepEqual(stored, ["spc_mla vst_new irfad"]);
  const input = sent[0]!;
  assert.equal(input["username"], "irfad");
  assert.equal(input["password"], "kept password");
  assert.equal(input["currentPassword"], "other password");
  const keys = input["keys"] as Parameters<typeof openBundle>[1];
  const opened = await openBundle("kept password", keys, { argon: FAST });
  assert.ok(same(opened.personKey, kept.personKey));
  assert.ok(same(heldKeyOf(opened), other.personKey));
  assert.ok(same(heldKeyOf(await openWithRecovery("KEPT-CODE-AAAA-BBBB", keys, { argon: FAST })), other.personKey));
  // a wrong kept password sends nothing
  await assert.rejects(linkAccounts(sides[0]!, "wrong", sides[1]!, "other password", { deviceName: "Mac", deviceClass: "desktop" }, () => undefined, { argon: FAST }));
  assert.equal(sent.length, 1);
  // done: what changed, said plainly
  const done = await sheetText(<LinkSheet spaces={[]} device={{ deviceName: "Mac", deviceClass: "desktop" }} onSession={() => undefined} onClose={() => undefined} initial={{ sides, keep: "spc_personal", done: true }} />);
  assert.ok(done.includes("MLA now signs you in as irfad"));
  const none = await sheetText(<LinkSheet spaces={[]} device={{ deviceName: "Mac", deviceClass: "desktop" }} onSession={() => undefined} onClose={() => undefined} initial={{ sides: [sides[0]!, { ...sides[1]!, publicKey: kept.publicKey }] }} />);
  assert.ok(none.includes("already uses one Vyre account"));
});
