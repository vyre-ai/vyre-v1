// @reads /modules/sync/migrations/0001_pull.sql
// The client cannot import sync/src/protocol.ts and the hub cannot import the client, so each has its own copy of the frame shapes and the timing constants. This file holds the two together.
import test from "node:test";
import assert from "node:assert/strict";
import { memoryLink, HEARTBEAT_DEAD_MS as CLIENT_DEAD, HEARTBEAT_MS as CLIENT_HB, readEvent, readHelloOk } from "../../../client/src/connection/index.ts";
import { HEARTBEAT_DEAD_MS, HEARTBEAT_MS, parseFrame } from "../../../sync/src/protocol.ts";
import type { Frame } from "../../../sync/src/protocol.ts";
import { ADA, liveRig, settle } from "./live.rig.test.ts";

test("timing constants agree: heartbeat every 15 s, silence of 40 s is dead", () => {
  assert.equal(CLIENT_HB, HEARTBEAT_MS);
  assert.equal(CLIENT_DEAD, HEARTBEAT_DEAD_MS);
});

test("frames the hub sends are frames the protocol validator and the client reader both accept", async () => {
  const rig = liveRig();
  rig.row("c1");
  const link = memoryLink();
  const got: unknown[] = [];
  link.client.onFrame((f) => got.push(f));
  rig.hub.accept(link.server, { person: ADA, device: "dev1", deviceClass: "desktop" });
  link.client.send({ t: "hello", hello: { deviceId: "dev1", deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", cursor: 0, epoch: 0, replica: { entities: {} } } });
  await settle();
  const ok = got.find((f) => (f as { t: string }).t === "hello_ok")!;
  const ev = got.find((f) => (f as { t: string }).t === "ev")!;
  for (const f of [ok, ev]) assert.ok(parseFrame(f).ok, "protocol accepts it");
  assert.equal(readHelloOk(ok)?.mode, "live");
  const batch = readEvent(ev)!;
  assert.equal(batch.items[0]!.id, "c1");
  assert.equal(batch.seq, (ev as Extract<Frame, { t: "ev" }>).seq);
  rig.hub.close();
});

test("frames the client sends are frames the protocol validator accepts", async () => {
  const rig = liveRig();
  const sent: unknown[] = [];
  const a = rig.client(ADA, "dev_a");
  a.conn.start();
  await settle();
  for (const l of rig.links) l.link.client.send({ t: "hb", seq: 0 });
  for (const l of rig.links) sent.push(...l.link.sent.client.map((s) => JSON.parse(s) as unknown));
  assert.ok(sent.length >= 2);
  for (const f of sent) assert.ok(parseFrame(f).ok, JSON.stringify(f));
  a.conn.stop();
  rig.hub.close();
});
