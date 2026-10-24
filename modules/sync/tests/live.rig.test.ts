// @reads /modules/sync/migrations/0001_pull.sql
// The rig the live tests share: a real log and pull behind a live hub, one clock for hub and clients, memory links that a test can cut or silence, and device clients built on the real connection manager.
// This file also checks the rig, so importing it from another test file adds one small test.
import test from "node:test";
import assert from "node:assert/strict";
import { createConnection, endpoint, manualScheduler, memoryLink } from "../../../client/src/connection/index.ts";
import type { Connection, Dial, EventBatch, ManualScheduler, MemoryLink } from "../../../client/src/connection/index.ts";
import type { LiveHub, LiveWho } from "../../../sync/src/live/index.ts";
import { createSyncLiveHub } from "../handlers/live.ts";
import type { LiveOpts } from "../handlers/live.ts";
import { ADA, BO, CY, NOW } from "../fixtures/world.ts";
import { pushRig } from "./push.rig.test.ts";
import type { PushRig } from "./push.rig.test.ts";

export { ADA, BO, CY, NOW };
export const settle = async (rounds = 12): Promise<void> => { for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r)); };

export interface DeviceClient { conn: Connection; st: { cursor: number; applied: EventBatch[]; at: number[]; ids: string[] } }
export interface LiveRig {
  r: PushRig;
  sched: ManualScheduler;
  hub: LiveHub;
  links: { url: string; person: string; device: string; link: MemoryLink }[];
  refused: Set<string>;
  /** Sockets open now. */
  open(): number;
  /** Silence every link (existing and future) that went to this url. */
  blackhole(url: string, on?: boolean): void;
  client(person: string, device: string, over?: { urls?: string[]; cursor?: number }): DeviceClient;
  /** A row of the contact type through the log. */
  row(id: string, fields?: Record<string, unknown>): number;
  patch(id: string, fields: Record<string, unknown>): number;
}

export function liveRig(opts: Partial<LiveOpts> = {}): LiveRig {
  const r = pushRig();
  const sched = manualScheduler(NOW);
  const hub = createSyncLiveHub(r.s.deps, { clock: sched, registryHash: "h1", ...opts });
  const links: LiveRig["links"] = [];
  const refused = new Set<string>();
  const dark = new Set<string>();
  const rig: LiveRig = {
    r, sched, hub, links, refused,
    open: () => links.filter((l) => l.link.isOpen()).length,
    blackhole(url, on = true) {
      if (on) dark.add(url); else dark.delete(url);
      for (const l of links) if (l.url === url) l.link.blackhole(on);
    },
    client(person, device, over = {}) {
      const st = { cursor: over.cursor ?? 0, applied: [] as EventBatch[], at: [] as number[], ids: [] as string[] };
      const who: LiveWho = { person, device, deviceClass: "desktop" };
      const dial: Dial = async (ep) => {
        if (refused.has(ep.url)) throw new Error(`refused ${ep.url}`);
        const link = memoryLink();
        if (dark.has(ep.url)) link.blackhole(true);
        links.push({ url: ep.url, person, device, link });
        hub.accept(link.server, who);
        return link.client;
      };
      const urls = over.urls ?? ["wss://direct.example/live", "wss://relay.example/live"];
      const conn = createConnection({
        space: "sp1", endpoints: urls.map((u, i) => endpoint(i === 0 ? "direct" : "relay", u)), dial, scheduler: sched,
        hello: () => ({ deviceId: device, deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", epoch: 0, replica: { entities: {} } }),
        cursor: { get: () => st.cursor, set: (n) => { st.cursor = n; } },
        apply: (b) => { st.applied.push(b); st.at.push(performance.now()); for (const c of b.items) st.ids.push(`${c.id}@${c.seq}`); },
      });
      return { conn, st };
    },
    row: (id, fields = {}) => r.seed("contact", id, { name: id, email: `${id}@example.com`, phone: "+1555", region: "eu", stage: "lead", owner: ADA, ...fields }),
    patch: (id, fields) => r.s.host.append({ type: "sync.row", sv: 1, trace_id: "0123456789abcdef0123456789abcdef", actor: ADA, vis: "space", payload: { entity: "contact", id, op: "patch", fields, at: NOW } } as never).seq,
  };
  return rig;
}

test("the rig connects a device through the real manager and delivers a committed row", async () => {
  const rig = liveRig();
  const a = rig.client(ADA, "dev_a");
  a.conn.start();
  await settle();
  rig.row("c1");
  rig.hub.commit();
  await settle();
  assert.deepEqual(a.st.ids.map((x) => x.split("@")[0]), ["c1"]);
  a.conn.stop();
  rig.hub.close();
});
