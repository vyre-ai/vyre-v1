// A replayed invite on a Space reached at its phone address (review Pass 7, 12 Nov 2026). The owner sends the first link; a slow answer and a retry replay the create, which hands out a fresh code.
// The first link's key is derived from the FIRST code's hash, so the box must still answer a hello under it: the daemon offers the relay every open invite's current and earlier code hashes
// (host/src/daemon/invite-hashes.ts). Real members handlers make and replay the invite; their rows go into a real SQLite file read by openInviteHashes; a real relay node on loopback and the box's
// own responder carry the device hello. The test lives in test/ because host may not import relay/ and relay/ may not import host (boundaries.json).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRelay } from "../relay/node/server.js";
import { openChannel, request } from "../relay/client/client.js";
import { webCrypto } from "../relay/client/webcrypto.js";
import { INVITE_TRIES, inviteKeyOf, loadRelayKeys, startRelayBox } from "../host/src/seams/relay.ts";
import { openInviteHashes } from "../host/src/daemon/invite-hashes.ts";
import { handlers } from "../modules/members/impl.ts";
import { hashCode } from "../modules/members/projections.ts";
import { harness, KEYS } from "../modules/members/fixtures/db.ts";

const utf8 = (s) => new TextEncoder().encode(s);
const fromB64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));
const codeFrom = (link) => /\/join\/([A-Z0-9-]+)#/.exec(link)[1];

/** The members rows, copied into a real SQLite database as the daemon holds them (only the columns openInviteHashes reads). */
function sqliteOf(h, withEarlier = true) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE members_invites (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, state TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  );
  for (const r of h.raw.rows("members_invites"))
    db.prepare("INSERT INTO members_invites VALUES (?, ?, ?, ?, ?)").run(
      r.id,
      r.code_hash,
      r.state,
      r.expires_at,
      r.created_at,
    );
  if (withEarlier) {
    db.exec(`CREATE TABLE members_invite_codes (code_hash TEXT PRIMARY KEY, invite TEXT NOT NULL)`);
    for (const r of h.raw.rows("members_invite_codes"))
      db.prepare("INSERT INTO members_invite_codes VALUES (?, ?)").run(r.code_hash, r.invite);
  }
  return { all: (sql, ...a) => db.prepare(sql).all(...a) };
}

async function world(invites) {
  const seen = [];
  const gateway = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    });
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  const relay = createRelay();
  const base = await relay.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-replay-"));
  const box = startRelayBox({
    relayUrl: base,
    dataDir: dir,
    localPort: () => gateway.address().port,
    onState: () => {},
    invites,
  });
  const { route } = await box.ready;
  const keys = loadRelayKeys(dir);
  const stop = async () => {
    box.stop();
    await relay.close().catch(() => {});
    await new Promise((r) => gateway.close(r));
  };
  return { base, route, keys, seen, stop };
}
async function dial(w, pub) {
  const crypto = webCrypto();
  const { channel } = await openChannel({
    relay: w.base,
    route: w.route,
    box: fromB64u(pub),
    keys: await crypto.generateKeyPair(),
    crypto,
    WebSocket: globalThis.WebSocket,
    hello: { v: 1 },
    timeout: 10_000,
  });
  return channel;
}
const preview = async (ch) =>
  (
    await request(
      ch,
      { method: "POST", path: "/v1/members/invites/preview", headers: { "content-type": "application/json" } },
      utf8("{}"),
    )
  ).status;

test("the FIRST link of a replayed invite opens the join page through the relay, as the fresh one does; a used invite's links open nothing", async () => {
  const h = harness();
  const make = async () =>
    codeFrom(
      (await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: "phone-1" }))
        .link,
    );
  const code1 = await make();
  const code2 = await make(); // the slow answer's retry
  assert.notEqual(code1, code2);
  let db = sqliteOf(h);
  const w = await world(() => openInviteHashes(db, h.now(), INVITE_TRIES));
  try {
    for (const code of [code1, code2]) {
      const ch = await dial(w, (await inviteKeyOf(w.keys.boxPriv, hashCode(code))).pub);
      try {
        assert.equal(
          await preview(ch),
          200,
          `the link with ${code === code1 ? "the first" : "the fresh"} code reaches the join page`,
        );
      } finally {
        ch.close(1000, "done");
      }
    }
    // used: both links are spent, at the relay as at the gateway
    await handlers["members.accept"](h.anon, {
      code: code1,
      username: "dana",
      displayName: "Dana",
      password: "a long enough password",
      deviceName: "Dana's phone",
      deviceClass: "web",
      keys: KEYS,
    });
    db = sqliteOf(h);
    for (const code of [code1, code2])
      await assert.rejects(
        async () => dial(w, (await inviteKeyOf(w.keys.boxPriv, hashCode(code))).pub),
        "a used invite's key opens no channel",
      );
  } finally {
    await w.stop();
  }
});

test("before the fix (only the current code offered), the first link of a replayed invite got no answer", async () => {
  const h = harness();
  const make = async () =>
    codeFrom(
      (await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: "phone-2" }))
        .link,
    );
  const code1 = await make();
  await make();
  const db = sqliteOf(h, false);
  const w = await world(() => openInviteHashes(db, h.now(), INVITE_TRIES));
  try {
    await assert.rejects(
      async () => dial(w, (await inviteKeyOf(w.keys.boxPriv, hashCode(code1))).pub),
      "the old offer set had no key for the first code",
    );
  } finally {
    await w.stop();
  }
});
