// Access events between the computers of one Personal Space (POST /v1/peers/access, lane l-multidevice) are a door to "who may do what", so it is shut to everyone but a computer of this Space:
//   1. only a computer's own token answers: no token, a person's session, a made-up token and a token of another Space all get 401; and the computer asking dials only a computer pinned to
//      the Space's box key, so a stranger cannot pose as the other side;
//   2. an event about another Space, or one that would make or move the Space itself, is refused, never appended;
//   3. the same event twice is folded once; an id reused with other content is refused;
//   4. a computer taken out of the Space is refused at once.
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "../relay/node/server.js";
import { OWNER, boot, call, firstComputer, stageSecond } from "./peers-kit.mjs";
import { accessCheck, sameContent } from "../host/src/peers/sync.ts";

const ask = (d, authorization) => fetch(`${d.url}/v1/peers/access`, { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: '{"since":0}' });

test("the access door answers only this Space's own computers, refuses other Spaces' events, folds once, and shuts on removal", { timeout: 60_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  let A = null, B = null, C = null;
  try {
    const first = await firstComputer(base);
    A = first.A;
    const { dirB, peerId, token } = await stageSecond(A, first.dirA);
    B = await boot(dirB, ["--space", "spc_staged", "--relay", base, "--peer-name", "Home laptop"]);
    await B.peers.tick();

    // 1. who may ask
    assert.equal((await ask(A, null)).status, 401, "no token");
    assert.equal((await ask(A, `Bearer ${OWNER}`)).status, 401, "a person's session is not a computer's token");
    assert.equal((await ask(A, `Peer vpt_${"x".repeat(43)}`)).status, 401, "a made-up token");
    const other = await firstComputer(base);   // another Personal Space with a computer of its own
    C = other.A;
    const theirs = (await import("node:fs")).readFileSync((await import("node:path")).join(other.dirA, "peer.token"), "utf8").trim();
    assert.equal((await ask(A, `Peer ${theirs}`)).status, 401, "a computer of another Space");
    const mine = await ask(A, `Peer ${token}`);
    assert.equal(mine.status, 200, "this Space's computer");
    const page = (await mine.json()).data;
    assert.ok(page.events.length > 0 && page.events.every((e) => e.payload && typeof e.id === "string"));

    // 2. what may be appended
    const space = A.space;
    assert.equal(accessCheck({ id: "evt_x", type: "grant.created", payload: { space: "spc_elsewhere" } }, space), "about another Space");
    assert.equal(accessCheck({ id: "evt_y", type: "resource.created", payload: { id: "spc_new", type: "space", owner_id: "usr_mallory" } }, space), "makes or moves the Space itself");
    assert.equal(accessCheck({ id: "evt_z", type: "space.ownership_transferred", payload: { from: "usr_olivia", to: "usr_mallory" } }, space), "not an access event");
    assert.equal(accessCheck({ id: "evt_ok", type: "resource.created", payload: { id: "fld_1", type: "folder", parent_id: space } }, space), null);
    const port = A.peers.accessPort();
    const before = (await A.log.currentHead()).seq;
    const bad = await port.fold([
      { seq: 1, id: "evt_peer_bad1", type: "grant.created", sv: 1, actor: "svc_host", vis: "space", trace_id: "c0".repeat(16), payload: { id: "gr_x", space: "spc_elsewhere", subject_kind: "actor", subject_id: "usr_mallory", resource_type: "space", resource_id: "spc_elsewhere", level: "edit" } },
      { seq: 2, id: "evt_peer_bad2", type: "resource.created", sv: 1, actor: "svc_host", vis: "space", trace_id: "c0".repeat(16), payload: { id: "spc_new", type: "space", parent_id: null, label: 0, owner_id: "usr_mallory", holds: 0 } },
    ]);
    assert.deepEqual(bad, { folded: 0, refused: 2 });
    assert.equal((await A.log.currentHead()).seq, before, "nothing was appended");

    // 3. replay
    const ev = { seq: 9, id: "evt_peer_folder_once", type: "resource.created", sv: 1, actor: "svc_host", vis: "space", trace_id: "c0".repeat(16), entity: "resource", entity_id: "fld_peer_once", payload: { id: "fld_peer_once", type: "folder", parent_id: space, label: 0, owner_id: "usr_olivia", holds: 0 } };
    assert.deepEqual(await port.fold([ev]), { folded: 1, refused: 0 });
    assert.deepEqual(await port.fold([ev]), { folded: 0, refused: 0 }, "the same event again is not folded again");
    assert.deepEqual(await port.fold([{ ...ev, payload: { ...ev.payload, owner_id: "usr_mallory" } }]), { folded: 0, refused: 1 }, "an id reused with other content is refused");
    assert.equal(sameContent({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }), true);

    // 4. removal shuts the door at once
    const removed = await call(A, "/v1/network/peer_remove", { peerId });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal((await ask(A, `Peer ${token}`)).status, 401, "a computer taken out is refused at once");
    assert.equal((await fetch(`${A.url}/v1/peers/changes`, { method: "POST", headers: { "content-type": "application/json", authorization: `Peer ${token}` }, body: '{"store":"modules","since":0}' })).status, 401, "and so are its other asks");
  } finally {
    await B?.stop();
    await C?.stop();
    await A?.stop();
    await relay.close();
  }
});
