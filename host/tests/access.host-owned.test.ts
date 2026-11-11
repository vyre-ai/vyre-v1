// What the host registers in the Space owner's name carries one mark (host/src/daemon/access.ts spaceOwned), so a Space ownership transfer moves it (review 3 of #905, N1 and N3).
//   1  every resource.created the host writes with the Space owner as owner goes through spaceOwned or hostOwned: a new registration without the mark fails here
//   2  registrations from before the mark are found in the log (hostOwnedMarks): the host's own, under the Space, owned by the Space owner of that moment; not an agent, not a person's
//   3  the access sync's log connection is never opened again after shutdown closed it (N4)
//   4  a long catch-up lets the event loop run between pages (N2)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accessBatch, createLogReader, hostOwnedMarks } from "../src/daemon/access.ts";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith(".ts") ? [path.join(dir, d.name)] : []));

test("1 every host registration in the Space owner's name carries the mark", () => {
  const unmarked: string[] = [];
  let seen = 0;
  for (const f of files(SRC)) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/["']resource\.created["']/g)) {
      // the statement around it: up to the next line that closes an appendResult call or the object, at most six lines
      const tail = text.slice(m.index!, m.index! + 1200).split("\n").slice(0, 6).join("\n");
      // the payload, which the host writes on one line: its owner is the Space owner when it names access.owner() or cfg.owner
      const at = tail.search(/payload\s*:/);
      if (at < 0) continue;
      const payload = tail.slice(at).split("\n")[0]!;
      if (!/access\.owner\(\)|cfg\.owner/.test(payload)) continue;
      seen++;
      if (!/^payload\s*:\s*(spaceOwned|hostOwned)\(/.test(payload)) unmarked.push(`${path.relative(SRC, f)}: ${payload.trim().slice(0, 120)}`);
    }
  }
  assert.ok(seen >= 7, `the scan found the host's registrations (${seen})`);
  assert.deepEqual(unmarked, [], "a registration in the Space owner's name without spaceOwned/hostOwned");
});

test("2 registrations from before the mark are found in the log", () => {
  const SPACE = "spc_x";
  const enc = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o));
  const ev = (seq: number, id: string, type: string, actor: string, payload: unknown) => ({ seq, id, type, actor, payload: enc(payload) });
  const res = (id: string, type: string, owner: string, parent: string | null = SPACE) => ({ id, type, parent_id: parent, label: 0, owner_id: owner, holds: 0 });
  const events = [
    ev(1, "evt_boot_1", "resource.created", "svc_host", res(SPACE, "space", "usr_ana", null)),
    ev(2, "evt_res_connector_google", "resource.created", "svc_host", res("google", "connector", "usr_ana")),
    ev(3, "evt_res_sit_default", "resource.created", "svc_host", res("sit_default", "site", "usr_ana")),
    ev(4, "evt_res_agt_1", "resource.created", "svc_host", res("agt_1", "agent", "usr_ana")),                 // an agent is its person's
    ev(5, "evt_custom", "resource.created", "usr_ana", res("leads", "record_type", "usr_ana")),               // a person's own
    ev(6, "evt_res_fld_p", "resource.created", "svc_host", res("fld_p", "folder", "usr_ana")),
    ev(7, "evt_private_root_fld_p_6", "resource.created", "svc_host", res("fld_p", "folder", "usr_ana", null)),   // made a Personal root since: not the Space's
    ev(8, "evt_move", "space.ownership_transferred", "usr_ana", { from: "usr_ana", to: "usr_ben" }),
    ev(9, "evt_res_kit_x", "resource.created", "svc_host", res("kit_x", "kit", "usr_ben")),                 // after the transfer: the new owner's
    ev(10, "evt_res_kit_y", "resource.created", "svc_host", res("kit_y", "kit", "usr_ana")),                // the former owner's, after the transfer: not the Space's
  ];
  assert.deepEqual(hostOwnedMarks(events, SPACE).map((m) => m.id).sort(), ["google", "kit_x", "sit_default"]);
});

test("3 the access sync's log connection is never opened again after shutdown closed it", () => {
  let opens = 0, closes = 0;
  const r = createLogReader(() => { opens++; return { all: () => [], close: () => { closes++; } }; });
  assert.equal(r.opened(), false, "nothing is opened before the first read");
  r.read(0, 10); r.read(0, 10);
  assert.equal(opens, 1);
  r.close();
  assert.equal(closes, 1);
  assert.throws(() => r.read(0, 10), /closed/);
  assert.equal(opens, 1, "not opened again");
  assert.equal(r.opened(), false, "no handle left");
});

test("4 a catch-up of many pages lets the event loop run between pages", async () => {
  const N = 100_000;
  const log = Array.from({ length: N }, (_, i) => ({ seq: i + 1, type: "record.created", payload: new Uint8Array([123, 125]) }));
  // Counted without a clock: each page read queues a task for the event loop, and it can only run if the catch-up hands the loop back before the next page. A timer was counted here
  // before; on a fast or busy computer the whole catch-up takes a few milliseconds and a timer fires fewer times than there are pages (seen: 8 of 10 wanted), though every page yielded.
  let between = 0;
  let pages = 0;
  const b = await accessBatch({ held: [], fedTo: 0, booted: true, read: async (after, limit) => { pages++; setImmediate(() => { between++; }); return log.slice(after, after + limit); } });
  assert.equal(b.upTo, N);
  assert.equal(pages, N / 2000 + 1, "fifty full pages and the empty one that ends it");
  assert.equal(between, N / 2000, `the event loop ran after every full page (${between} of ${N / 2000})`);
});
