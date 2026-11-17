// A large law-firm-shaped Space reached through a real relay the way a browser on vyre.run reaches it (r34-bigspace).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { boot, call, seededDir } from "./live.ts";
import { createRelay } from "../../relay/node/server.js";
import { Connection, RelaySocket, openChannel, request } from "../../relay/client/client.js";
import { webCrypto } from "../../relay/client/webcrypto.js";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
export async function cap(d: Daemon, c: string, input: Record<string, unknown> = {}): Promise<Any> {
  const r = await call(d, c, { idempotencyKey: `big-${c}-${++n}-${Math.random()}`, ...input });
  assert.equal(r.status, 200, `${c}: ${JSON.stringify(r.data).slice(0, 400)}`);
  return r.data;
}

export interface Size {
  matters: number;
  fields: number;
  contacts: number;
  orgs: number;
}
export const FIRM: Size = { matters: 9400, fields: 100, contacts: 28000, orgs: 1100 };

const word = (i: number, f: number): string =>
  `Matter ${i} field ${f} ${"lorem ipsum dolor sit amet ".repeat(2)}`.trim();

export async function seed(d: Daemon, s: Size, log: (m: string) => void): Promise<void> {
  const t0 = Date.now();
  const fields = Array.from({ length: s.fields }, (_, f) => ({ key: `f${f}`, type: "text", title: `Field ${f}` }));
  await cap(d, "schema.apply", {
    ops: [
      {
        op: "type.create",
        type: "rt_matter",
        def: {
          title: "Matter",
          plural: "Matters",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "Name", required: true }, ...fields],
        },
      },
      {
        op: "type.create",
        type: "rt_organization",
        def: {
          title: "Organization",
          plural: "Organizations",
          icon: "table",
          titleField: "name",
          fields: [{ key: "name", type: "text", title: "Name", required: true }],
        },
      },
    ],
  });
  const batch = async (type: string, total: number, make: (i: number) => Record<string, unknown>): Promise<void> => {
    for (let at = 0; at < total; at += 500) {
      const rows = Array.from({ length: Math.min(500, total - at) }, (_, i) => make(at + i));
      await cap(d, "records.bulk_upsert", { type, match: ["name"], rows, createOnly: true, runAutomations: false });
    }
    log(`seeded ${total} ${type} at ${Date.now() - t0} ms`);
  };
  await batch("rt_organization", s.orgs, (i) => ({ name: `Org ${i}` }));
  await batch("contact", s.contacts, (i) => ({ name: `Person ${i}`, email: `p${i}@northwind.example` }));
  await batch("rt_matter", s.matters, (i) => ({
    name: `Matter ${i}`,
    ...Object.fromEntries(Array.from({ length: s.fields }, (_, f) => [`f${f}`, word(i, f)])),
  }));
}

export interface Rig {
  d: Daemon;
  dir: string;
  base: string;
  stop(): Promise<void>;
  /** Open a relay channel the way the browser does. */
  channel(): Promise<{ conn: Any; ch: Any }>;
}

export async function rig(dir: string): Promise<Rig> {
  const relay = createRelay();
  const base = await relay.listen();
  const d = await boot(dir, null, { args: ["--relay", base] });
  return {
    d,
    dir,
    base,
    async stop() {
      await d.stop();
      await relay.close?.();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async channel() {
      const eps = await cap(d, "network.endpoints");
      const e = (eps.endpoints as Any[]).find((x) => x.kind === "relay");
      assert.ok(e, "a relay endpoint");
      const url = new URL(e.url);
      const route = url.searchParams.get("route")!;
      const box = new Uint8Array(Buffer.from(/^#box=(.+)$/.exec(url.hash)![1]!, "base64url"));
      const crypto = webCrypto();
      const keys = await crypto.generateKeyPair();
      const { channel } = await openChannel({
        relay: base,
        route,
        box,
        keys,
        crypto,
        WebSocket: globalThis.WebSocket,
        hello: { v: 1, name: "a browser" },
        timeout: 15_000,
      });
      return { conn: null, ch: channel };
    },
  };
}

export const registryHash = (): string =>
  createHash("sha256")
    .update(fs.readFileSync(new URL("../../generated/registry.json", import.meta.url)))
    .digest("hex");

export { seededDir, RelaySocket, request };
