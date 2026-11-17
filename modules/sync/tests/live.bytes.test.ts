// @reads /modules/sync/migrations/0001_pull.sql
// The live hub sizes every `ev` frame by bytes (17 Nov 2026: a firm's Space of 9,400 matters of 100 fields sent 500 changes per frame, several MB, and the relay refused them, so the stream restarted forever).
// A frame carries about half a MiB of changes, a change too big for one frame goes in pieces that still add up to the change, a field too big for any frame is pulled by the device, and a web page is sent no rows at all.
import test from "node:test";
import assert from "node:assert/strict";
import { memoryLink } from "../../../client/src/connection/index.ts";
import { parseFrame } from "../../../sync/src/protocol.ts";
import type { Change, Frame } from "../../../sync/src/protocol.ts";
import type { LiveWho } from "../../../sync/src/live/index.ts";
import { ADA } from "../fixtures/world.ts";
import { liveRig, settle } from "./live.rig.test.ts";
import type { LiveRig } from "./live.rig.test.ts";

const LIMIT = 1 << 20;
const bytes = (f: unknown): number => new TextEncoder().encode(JSON.stringify(f)).length;

function device(rig: LiveRig, deviceClass: "desktop" | "web" = "desktop", cursor = 0) {
  const link = memoryLink();
  const frames: Frame[] = [];
  const sizes: number[] = [];
  link.client.onFrame((f) => {
    const p = parseFrame(f);
    assert.ok(p.ok, p.ok ? "" : p.error);
    if (p.ok) {
      frames.push(p.value);
      sizes.push(bytes(f));
    }
  });
  const who: LiveWho = { person: ADA, device: `dev_${deviceClass}`, deviceClass };
  rig.hub.accept(link.server, who);
  link.client.send({
    t: "hello",
    hello: {
      deviceId: who.device,
      deviceClass,
      appVersion: "1.0.0",
      registryHash: "h1",
      cursor,
      epoch: 0,
      replica: { entities: {} },
    },
  });
  const evs = () => frames.filter((f): f is Extract<Frame, { t: "ev" }> => f.t === "ev");
  const ack = async () => {
    for (const e of evs().slice(acked)) link.client.send({ t: "ack", seq: e.seq });
    acked = evs().length;
    await settle();
  };
  let acked = 0;
  return { link, frames, sizes, evs, ack, send: (f: unknown) => link.client.send(f) };
}

/** Everything a device is sent, acking each frame the way the client does, until nothing more comes. */
async function drain(d: ReturnType<typeof device>): Promise<Change[]> {
  for (let i = 0; i < 400; i++) {
    const n = d.evs().length;
    await settle();
    await d.ack();
    if (d.evs().length === n) break;
  }
  return d.evs().flatMap((e) => e.items);
}

test("60 rows of 40 KB reach a device in frames of about half a MiB, none near the relay's limit", async () => {
  const rig = liveRig();
  for (let i = 0; i < 60; i++) rig.row(`big${i}`, { name: `n${i}-${"x".repeat(40_000)}` });
  const d = device(rig);
  const got = await drain(d);
  assert.deepEqual(
    [...new Set(got.map((c) => c.id))].sort(),
    Array.from({ length: 60 }, (_, i) => `big${i}`).sort(),
    "every row arrives",
  );
  assert.ok(d.evs().length >= 4, `the 2.4 MB went in several frames, not ${d.evs().length}`);
  assert.ok(Math.max(...d.sizes) < 700 * 1024, `no frame over 700 KB: ${Math.max(...d.sizes)}`);
  rig.hub.close();
});

test("one change of 1.25 MB in five fields is sent in pieces that add up to the change, every frame under the relay's limit", async () => {
  const rig = liveRig();
  const f = (c: string) => c.repeat(250_000);
  const s1 = rig.row("huge", { name: f("a"), email: f("b"), phone: f("c"), region: f("e"), stage: f("d"), amount: 1 });
  const s2 = rig.row("after");
  const d = device(rig);
  const got = await drain(d);
  assert.ok(Math.max(...d.sizes) < LIMIT - 64 * 1024, `no frame near 1 MiB: ${Math.max(...d.sizes)}`);
  const whole: Record<string, unknown> = {};
  for (const c of got.filter((x) => x.id === "huge")) for (const [k, v] of Object.entries(c.fields)) whole[k] = v.v;
  assert.equal((whole["name"] as string).length, 250_000);
  assert.equal((whole["stage"] as string).length, 250_000);
  assert.equal(whole["amount"], 1);
  assert.ok(
    got.some((c) => c.id === "after"),
    "the row after it arrives",
  );
  const nums = d.evs().map((e) => e.seq);
  assert.ok(
    nums.every((n, i) => i === 0 || n >= nums[i - 1]!),
    `frames are numbered in order: ${nums}`,
  );
  assert.ok(s1 < s2);
  rig.hub.close();
});

test("a single field heavier than any frame is not sent: the device is hinted to pull it, the stream waits and goes on when the device says it has", async () => {
  const rig = liveRig();
  const s1 = rig.row("before");
  const s2 = rig.row("giant", { name: "g".repeat(1_300_000) });
  const s3 = rig.row("after");
  const d = device(rig);
  await settle();
  await d.ack();
  assert.ok(
    Math.max(...d.sizes) < LIMIT - 64 * 1024,
    `nothing near the relay limit was sent: ${d.frames.map((f, i) => f.t + ":" + d.sizes[i]).join(" ")}`,
  );
  assert.ok(
    d.frames.some((f) => f.t === "pull_hint"),
    "the device is hinted to pull",
  );
  assert.deepEqual(
    d.evs().flatMap((e) => e.items.map((c) => c.id)),
    ["before"],
    "only what is before it",
  );
  assert.ok(s1 < s2 && s2 < s3);
  d.send({ t: "hb", seq: s2 }); // the device pulled it: its heartbeat carries its cursor
  await settle();
  await d.ack();
  assert.deepEqual(
    d.evs().flatMap((e) => e.items.map((c) => c.id)),
    ["before", "after"],
    "the stream goes on past it",
  );
  rig.hub.close();
});

test("a web page skips the history it never keeps, and gets every later change with its row", async () => {
  const rig = liveRig();
  for (let i = 0; i < 40; i++) rig.row(`w${i}`, { name: "x".repeat(30_000) });
  const d = device(rig, "web");
  await settle();
  await d.ack();
  assert.equal(d.evs().length, 1, "one empty frame on opening, at the head, so the page's cursor is current");
  assert.equal(d.evs()[0]!.items.length, 0, "and nothing of the 1.2 MB history");
  assert.ok(d.evs()[0]!.seq >= 40);
  rig.row("later");
  rig.hub.commit();
  await settle();
  assert.equal(d.evs().length, 2, "one frame for the change after");
  assert.deepEqual(
    d.evs()[1]!.items.map((c) => c.id),
    ["later"],
    "and it carries the row, so the open screen shows it live",
  );
  assert.ok(d.evs()[1]!.seq > d.evs()[0]!.seq);
  rig.hub.close();
});
