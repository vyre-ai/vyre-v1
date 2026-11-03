// Settings > Computers in a Personal Space: the computers that hold it (this one, awake ones, asleep ones with when they were last seen) and a new computer asking to use it, with the code
// its own screen shows and Allow and Decline (lane l-multidevice).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PeersBody, peerLine, whenLabel } from "./Peers.tsx";
import type { PeerRequestRow, PeerRow } from "./Peers.tsx";

const NOW = 1_800_000_000_000;
const noop = (): void => undefined;
const peer = (o: Partial<PeerRow>): PeerRow => ({ peerId: "peer_a", name: "Office iMac", platform: "darwin", kind: "computer", self: false, online: false, addedAt: NOW - 1e6, ...o });
const request: PeerRequestRow = { requestId: "preq_1", name: "Travel laptop", platform: "win32", code: "418 207", requestedAt: NOW - 1000, expiresAt: NOW + 60_000 };
const body = (peers: PeerRow[], requests: PeerRequestRow[] = [], removing: string | null = null): string =>
  renderToStaticMarkup(<PeersBody peers={peers} requests={requests} now={NOW} busy={false} removing={removing} error="" onAllow={noop} onDecline={noop} onAskRemove={noop} onRemove={noop} />).replaceAll("<!-- -->", "");

test("each computer says whether it is this one, awake, or asleep since when", () => {
  assert.equal(peerLine(peer({ self: true, online: true }), NOW), "This computer");
  assert.equal(peerLine(peer({ online: true }), NOW), "Awake");
  assert.equal(peerLine(peer({ online: true, kind: "server" }), NOW), "Server, on");
  assert.equal(peerLine(peer({ lastSeenAt: NOW - 3 * 3_600_000 }), NOW), "Asleep · last seen 3 hours ago");
  assert.equal(whenLabel(undefined, NOW), "never");
  const out = body([peer({ peerId: "peer_me", name: "Home laptop", self: true, online: true }), peer({ lastSeenAt: NOW - 120_000 })]);
  assert.ok(out.indexOf("Home laptop") < out.indexOf("Office iMac"));
  assert.ok(out.includes("This computer") && out.includes("Asleep · last seen 2 minutes ago"));
  assert.ok(!out.includes('data-testid="peer-remove-peer_me"'), "this computer cannot be removed from itself");
  assert.ok(out.includes('data-testid="peer-remove-peer_a"'));
});

test("a waiting computer comes first, with the code to check and Allow and Decline", () => {
  const out = body([peer({ self: true, online: true })], [request]);
  assert.ok(out.indexOf("Travel laptop wants to use this Personal Space") < out.indexOf("Office iMac"));
  assert.ok(out.includes("Check that it shows 418 207"));
  assert.ok(out.includes('data-testid="peer-allow-preq_1"') && out.includes('data-testid="peer-decline-preq_1"'));
});

test("Remove asks once more before it takes a computer out", () => {
  const out = body([peer({ self: true, online: true, peerId: "peer_me" }), peer({})], [], "peer_a");
  assert.ok(out.includes('data-testid="peer-remove-yes-peer_a"'));
});
