// Sign in on a new computer with the account you already use (lane l-multidevice): the screen finds the Personal Space on the other computer, shows the code the other computer shows, waits
// for the person to allow it there, then opens the account's key bundle with the password typed here before anything is copied. A stranger's bundle, or a wrong password, copies nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { makeBundle } from "../../../../client/src/crypto/keys.ts";
import type { PeerJoin, PeerJoinState } from "../../../../client/src/connection/peers.ts";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../ui/src/testing/dom.ts";
import { NONE_ANSWERED, OtherComputer, WRONG_PASSWORD } from "./OtherComputer.tsx";
import { JoinFrame } from "./kit.tsx";

const PASSWORD = "correct horse battery";

function fakeJoin(o: { offers?: number; states: PeerJoinState[] }) {
  const calls: string[] = [];
  const states = [...o.states];
  const j: PeerJoin = {
    find: async (u) => { calls.push(`find:${u}`); return Array.from({ length: o.offers ?? 1 }, (_, i) => ({ index: i, name: "Office iMac", space: "spc_personal" })); },
    request: async (i) => { calls.push(`request:${i}`); return { code: "418 207", name: "Office iMac" }; },
    status: async () => { calls.push("status"); return states.length > 1 ? states.shift()! : states[0]!; },
    commit: async () => { calls.push("commit"); return { space: "spc_personal" }; },
    cancel: async () => { calls.push("cancel"); },
  };
  return { j, calls };
}
const until = async (ok: () => boolean, what: string): Promise<void> => { for (let i = 0; i < 300; i++) { if (ok()) return; await flush(); } assert.fail(what); };

test("found by name, allowed on the other computer with the same code, opened with the password, then copied", { timeout: 60_000 }, async () => {
  const restore = installDom();
  try {
    const made = await makeBundle(PASSWORD, "K7QM-4TXD-9WPA-H3NE");
    const bundle = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped };
    const { j, calls } = fakeJoin({ states: [{ state: "pending", from: "Office iMac" }, { state: "allowed", from: "Office iMac", bundle, username: "irfad", space: "spc_personal", spaceName: "Personal" }] });
    let joined: { space: string; username: string; password: string } | null = null;
    const root = await mount(createRoot, <JoinFrame><OtherComputer join={j} pollMs={50} startLocal={async () => ({ address: "http://127.0.0.1:1" })} onJoined={(o) => { joined = o; }} onAddress={() => undefined} /></JoinFrame>);
    await typeInto(find(root, "peer-username"), "irfad");
    await typeInto(find(root, "peer-password"), PASSWORD);
    await press(find(root, "peer-find"));
    await until(() => !!find(root, "peer-offer-0"), "the other computer is offered");
    assert.match(textOf(find(root, "peer-offer-0")), /Use your Personal Space from Office iMac/);
    await press(find(root, "peer-offer-0"));
    await until(() => !!find(root, "peer-code"), "the code is shown");
    assert.equal(textOf(find(root, "peer-code")).trim(), "418 207");
    assert.match(textOf(root), /open Settings, then Computers, and allow this computer/);
    await until(() => joined !== null, "the copy is made once the bundle opens");
    assert.deepEqual(joined, { space: "spc_personal", username: "irfad", password: PASSWORD }, "the password goes on to sign in once, so it is not asked again");
    assert.deepEqual(calls.filter((c) => c !== "status"), ["find:irfad", "request:0", "commit"]);
  } finally { restore(); }
});

test("nobody answered: the screen says why and offers the address instead", async () => {
  const restore = installDom();
  try {
    const { j, calls } = fakeJoin({ offers: 0, states: [{ state: "pending", from: "x" }] });
    let byAddress = 0;
    const root = await mount(createRoot, <JoinFrame><OtherComputer join={j} pollMs={50} startLocal={async () => ({ address: "http://127.0.0.1:1" })} onJoined={() => assert.fail("nothing to join")} onAddress={() => { byAddress++; }} /></JoinFrame>);
    await typeInto(find(root, "peer-username"), "irfad");
    await typeInto(find(root, "peer-password"), PASSWORD);
    await press(find(root, "peer-find"));
    await until(() => textOf(find(root, "peer-error")).includes(NONE_ANSWERED), "says none answered");
    await press(find(root, "peer-address"));
    assert.equal(byAddress, 1);
    assert.deepEqual(calls, ["find:irfad"]);
  } finally { restore(); }
});

test("a bundle the password does not open copies nothing", { timeout: 60_000 }, async () => {
  const restore = installDom();
  try {
    const made = await makeBundle("someone else's password", "K7QM-4TXD-9WPA-H3NE");
    const bundle = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped };
    const { j, calls } = fakeJoin({ states: [{ state: "allowed", from: "Office iMac", bundle, username: "irfad", space: "spc_personal", spaceName: "Personal" }] });
    const root = await mount(createRoot, <JoinFrame><OtherComputer join={j} pollMs={50} startLocal={async () => ({ address: "http://127.0.0.1:1" })} onJoined={() => assert.fail("must not join")} onAddress={() => undefined} /></JoinFrame>);
    await typeInto(find(root, "peer-username"), "irfad");
    await typeInto(find(root, "peer-password"), PASSWORD);
    await press(find(root, "peer-find"));
    await until(() => !!find(root, "peer-offer-0"), "offered");
    await press(find(root, "peer-offer-0"));
    await until(() => textOf(find(root, "peer-error")).includes(WRONG_PASSWORD), "the wrong password is said");
    assert.equal(calls.includes("commit"), false, "nothing was copied");
  } finally { restore(); }
});
