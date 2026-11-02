// An invite on a Space reached at its phone address (AUDIT-logic-2nov rows 55, 62). A stranger has the link and nothing else: no box key, no session. The link carries a key of the invite's own
// (inviteKeyOf), and the box answers a hello under it only while that invite is open; a channel opened that way reaches the join page and its two signed-out calls, never a session, and a successful
// accept hands the box key back inside the channel. Against a real relay node on loopback and the box's own responder (host/src/seams/relay.ts), with a recording stand-in for the gateway.
// The test lives in test/ because host may not import relay/ and relay/ may not import host (boundaries.json).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRelay } from "../relay/node/server.js";
import { openChannel, request } from "../relay/client/client.js";
import { webCrypto } from "../relay/client/webcrypto.js";
import { INVITE_TRIES, inviteKeyOf, inviteScopeOk, loadRelayKeys, startRelayBox } from "../host/src/seams/relay.ts";

const utf8 = (s) => new TextEncoder().encode(s);
const fromB64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));
const HASH = "c2hhMjU2LW9mLWFuLWludml0ZS1jb2RlLWZvci10ZXN0cw==";

async function world() {
  const seen = [];
  const gateway = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, path: req.url, auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null });
      res.writeHead(200, { "content-type": "application/json", "x-vyre-box": "forged-by-the-gateway" });
      res.end(JSON.stringify({ path: req.url }));
    });
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  const relay = createRelay();
  const base = await relay.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-invite-"));
  const open = new Set([HASH]);
  const box = startRelayBox({ relayUrl: base, dataDir: dir, localPort: () => gateway.address().port, onState: () => {}, invites: () => [...open] });
  const { route, boxKey } = await box.ready;
  const keys = loadRelayKeys(dir);
  const stop = async () => { box.stop(); await relay.close().catch(() => {}); await new Promise((r) => gateway.close(r)); };
  return { base, route, boxKey, keys, open, seen, stop };
}

async function dial(w, pinned) {
  const crypto = webCrypto();
  const keys = await crypto.generateKeyPair();
  const { channel } = await openChannel({ relay: w.base, route: w.route, box: pinned, keys, crypto, WebSocket: globalThis.WebSocket, hello: { v: 1 }, timeout: 10_000 });
  return channel;
}

async function ask(channel, method, p, token) {
  const headers = { "content-type": "application/json", cookie: "a=b", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await request(channel, { method, path: p, headers }, method === "GET" ? new Uint8Array(0) : utf8("{}"));
  return { status: res.status, box: res.headers.get("x-vyre-box"), body: JSON.parse(await res.text()) };
}

test("the invite key is derived from the box key and the code hash, and is neither the box key nor another invite's", async () => {
  const w = await world();
  try {
    const a = await inviteKeyOf(w.keys.boxPriv, HASH);
    const again = await inviteKeyOf(w.keys.boxPriv, HASH);
    const b = await inviteKeyOf(w.keys.boxPriv, `${HASH.slice(0, -4)}AAA=`);
    assert.equal(a.pub, again.pub, "the same invite always has the same key: the box keeps nothing to find it again");
    assert.notEqual(a.pub, w.boxKey);
    assert.notEqual(a.pub, b.pub);
    assert.match(a.pub, /^[A-Za-z0-9_-]{43}$/);
  } finally { await w.stop(); }
});

test("an open invite's key opens a channel to the join page and its two calls, signed out, and nothing else", async () => {
  const w = await world();
  try {
    const key = await inviteKeyOf(w.keys.boxPriv, HASH);
    const ch = await dial(w, fromB64u(key.pub));
    try {
      for (const p of ["/", "/join/ABCD-1234", "/_expo/static/js/web/entry-abc.js", "/assets/node_modules/@expo/x.ttf", "/favicon.ico"]) {
        assert.equal((await ask(ch, "GET", p)).status, 200, p);
      }
      const preview = await ask(ch, "POST", "/v1/members/invites/preview", "tok-stolen");
      assert.equal(preview.status, 200);
      assert.equal(preview.box, null, "only a successful accept hands over the box key, and the gateway cannot forge one");
      for (const [m, p] of [["POST", "/v1/identity/whoami"], ["GET", "/v1/records/list"], ["POST", "/v1/members/invites/create"], ["DELETE", "/join/ABCD-1234"], ["GET", "/join/../v1/x"], ["GET", "/p/forms/x"], ["GET", "/local/vault/key/x"]]) {
        const r = await ask(ch, m, p, "tok-stolen");
        assert.equal(r.status, 403, `${m} ${p}`);
        assert.equal(r.body.error.code, "auth.invalid_code");
      }
      const accepted = await ask(ch, "POST", "/v1/members/accept");
      assert.equal(accepted.status, 200);
      assert.equal(accepted.box, w.boxKey, "the accept hands the box key back inside the channel");
      for (const s of w.seen) {
        assert.equal(s.auth, null, `no session crossed an invite channel (${s.path})`);
        assert.equal(s.cookie, null);
      }
      assert.deepEqual(w.seen.map((s) => s.path).filter((p) => p.startsWith("/v1/")), ["/v1/members/invites/preview", "/v1/members/accept"], "a refused request never reached the gateway");
      // the invite is spent: the channel it opened reaches nothing more
      w.open.delete(HASH);
      assert.equal((await ask(ch, "GET", "/")).status, 403, "a spent invite's channel is closed to everything");
    } finally { ch.close(1000, "done"); }
  } finally { await w.stop(); }
});

test("a used, revoked or expired invite's key, or a key nobody made, opens no channel; the box key opens the whole gateway as before", async () => {
  const w = await world();
  try {
    const key = await inviteKeyOf(w.keys.boxPriv, HASH);
    w.open.delete(HASH);
    await assert.rejects(() => dial(w, fromB64u(key.pub)), "an invite that is no longer open is refused at the handshake");
    const stranger = await webCrypto().generateKeyPair();
    await assert.rejects(() => dial(w, stranger.publicKey));
    const full = await dial(w, fromB64u(w.boxKey));
    try {
      const r = await ask(full, "POST", "/v1/identity/whoami", "tok-member");
      assert.equal(r.status, 200, "the box key's channel is not an invite channel");
      assert.equal(r.box, null, "the gateway's own x-vyre-box never leaves the box");
      assert.equal(w.seen.at(-1).auth, "Bearer tok-member", "a session still crosses the box key's channel; the gateway decides");
    } finally { full.close(1000, "done"); }
  } finally { await w.stop(); }
});

test("the invite scope, path by path", () => {
  const yes = [["GET", "/"], ["HEAD", "/"], ["GET", "/join"], ["GET", "/join/ABCD-1234"], ["GET", "/join/ABCD-1234/"], ["GET", "/manifest.json"], ["GET", "/_expo/static/css/a.css"], ["POST", "/v1/members/accept"], ["POST", "/v1/members/invites/preview?x=1"], ["GET", "/healthz"]];
  const no = [["WS", "/sync/v1/ws"], ["POST", "/join/ABCD-1234"], ["GET", "/v1/members/accept"], ["POST", "/v1/members/accept/x"], ["GET", "/assets/%2e%2e/v1/x"], ["GET", "/_expo/a\\b"], ["GET", "/a/sit_x/k/00"], ["GET", "/auth/sso/google/start"], ["GET", "/mcp"], ["GET", `/${"x".repeat(1100)}`], ["PUT", "/"]];
  for (const [m, p] of yes) assert.equal(inviteScopeOk(m, p), true, `${m} ${p}`);
  for (const [m, p] of no) assert.equal(inviteScopeOk(m, p), false, `${m} ${p}`);
  assert.ok(INVITE_TRIES >= 50 && INVITE_TRIES <= 500, "a hello is tried against a bounded number of invites");
});
