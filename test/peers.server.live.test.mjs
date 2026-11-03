// Bring your own server for a Personal Space (lane l-multidevice, increment 6). Two booted daemons and a real relay node: the person's computer makes a one-time code in Settings (the install line
// carries it as VYRE_PEER_JOIN), and a fresh server daemon started with it joins through the relay with no address of its own: it copies the whole Space, comes up as the same Space, stays in sync,
// and takes the scheduled-work lease from the computer, so automations and nightly jobs run there while the computers sleep. The code works once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRelay } from "../relay/node/server.js";
import { boot, call, firstComputer } from "./peers-kit.mjs";

test("a server joins a Personal Space with its code through the relay, holds the copy, syncs and runs the scheduled work", { timeout: 60_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  let A = null, S = null;
  try {
    ({ A } = await firstComputer(base));
    A.db.run("INSERT INTO chat_thread (id, kind, title, createdAt) VALUES ('thr_before', 'private', 'Written before the server came', 1)");

    const made = await call(A, "/v1/network/peer_server_code", { nickname: "home-server" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const code = made.body.data.code;
    assert.match(code, /^VYRE-PS-/);

    const dirS = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-server-"));
    S = await boot(dirS, ["--space", "spc_install_pick", "--relay", base, "--peer-name", "home-server", "--peer-kind", "server", "--peer-join", code]);
    assert.equal(S.space, A.space, "the server is the same Personal Space");
    assert.equal(S.db.all("SELECT title FROM chat_thread WHERE id = 'thr_before'")[0]?.title, "Written before the server came", "it holds the copy");
    const mine = S.db.all("SELECT p.kind, p.name FROM network_peer p JOIN network_peer_self s ON s.peer_id = p.id")[0];
    assert.deepEqual({ ...mine }, { kind: "server", name: "home-server" });
    await S.peers.tick();

    // it stays in sync
    A.db.run("INSERT INTO chat_thread (id, kind, title, createdAt) VALUES ('thr_after', 'private', 'Written after', 2)");
    await S.peers.sync.round();
    assert.equal(S.db.all("SELECT title FROM chat_thread WHERE id = 'thr_after'")[0]?.title, "Written after");

    // the server takes the scheduled work from the computer
    A.peers.sync.lease();
    await S.peers.sync.round();
    assert.equal(S.peers.sync.lease().mine, true, "a server takes the lease from a computer");
    await A.peers.sync.round();
    assert.equal(S.peers.mayRun("automations.schedule_tick"), true);
    assert.equal(A.peers.mayRun("automations.schedule_tick"), false, "the computer leaves it to the server");
    const list = await call(A, "/v1/network/peers");
    assert.ok(list.body.data.computers.some((c) => c.kind === "server" && c.name === "home-server"));

    // the code was used: a second server cannot use it
    const dirT = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-server2-"));
    await assert.rejects(boot(dirT, ["--relay", base, "--peer-kind", "server", "--peer-join", code]), /used|ran out/);
  } finally {
    await S?.stop();
    await A?.stop();
    await relay.close();
  }
});
