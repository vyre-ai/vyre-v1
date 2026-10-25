// Long lists: one subscription per list, rows read from a window cache, one row patched per change (never the 10k-row query again). A 10k-row window update stays under one frame.
import test from "node:test";
import assert from "node:assert/strict";
import { createChangeFeed } from "../store/index.ts";
import type { LocalDb, SpaceStore } from "../store/index.ts";
import { createQueryClient } from "./index.ts";
import type { ListDef } from "./index.ts";

interface Item { id: string; title: string; rank: number; open: number }
const ROWS = 10_000;

function setup() {
  const items: Item[] = Array.from({ length: ROWS }, (_, i) => ({ id: `it_${String(i).padStart(5, "0")}`, title: `Item ${i}`, rank: i, open: 1 }));
  const byId = new Map(items.map((r) => [r.id, r]));
  const changes = createChangeFeed();
  // LocalDb is the seam: the two statements the list asks for are answered from these rows (the ids read is index-only, the rows read is by id)
  const db: LocalDb = {
    all(sql, params = []) {
      if (sql.startsWith("SELECT id FROM item")) {
        return [...byId.values()].filter((r) => r.open === params[0]).sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map((r) => ({ id: r.id }));
      }
      return params.map((id) => byId.get(String(id))).filter((r): r is Item => r !== undefined).map((r) => ({ ...r }));
    },
  };
  const store: SpaceStore = { spaceId: "spc_a", db, changes };
  const set = (id: string, patch: Partial<Item>): void => { const cur = byId.get(id); if (cur) Object.assign(cur, patch); changes.emit({ entity: "item", id }); };
  const add = (id: string, title: string, rank: number, open = 1): void => { byId.set(id, { id, title, rank, open }); changes.emit({ entity: "item", id }); };
  const remove = (id: string): void => { byId.delete(id); changes.emit({ entity: "item", id }); };
  let rowReads = 0;
  const def: ListDef<{ open: number }, Item> = {
    cap: "item.list", entity: "item",
    orderIds: (d, i) => d.all("SELECT id FROM item WHERE open = ? ORDER BY rank, id", [i.open]).map((r) => String(r["id"])),
    readRows: (d, ids) => { rowReads += ids.length; return d.all(`SELECT id, title, rank, open FROM item WHERE id IN (${ids.map(() => "?").join(",")})`, ids) as unknown as Item[]; },
    idOf: (r) => r.id,
    matches: (r, i) => r.open === i.open,
    orderKey: (r) => r.rank,
  };
  return { store, changes, def, set, add, remove, reads: () => rowReads };
}

const win = (q: ReturnType<ReturnType<typeof createQueryClient>["list"]>) => { const s = q.getSnapshot(); assert.equal(s.status, "ready"); return (s as { data: ReturnType<typeof Object> }).data as unknown as import("./index.ts").ListWindow<Item>; };

test("only the window on screen is read, and scrolling reads the next rows once", () => {
  const t = setup();
  const client = createQueryClient(t.store);
  const q = client.list(t.def, { open: 1 });
  const w = win(q);
  assert.equal(w.count, ROWS);
  assert.equal(t.reads(), 0, "opening reads ids, not rows");
  const first = w.rows(0, 40);
  assert.equal(first.length, 40);
  assert.equal(t.reads(), 40);
  w.rows(0, 40);
  assert.equal(t.reads(), 40, "cached rows are not read again");
  w.rows(30, 80);
  assert.equal(t.reads(), 80, "only the 40 new rows were read");
  assert.equal(first[0]?.title, "Item 0");
});

test("a 10,000-row list updates one row inside a frame and the other rows keep their identity", () => {
  const t = setup();
  const client = createQueryClient(t.store);
  const q = client.list(t.def, { open: 1 });
  let calls = 0;
  q.subscribe(() => calls++);
  const before = win(q).rows(0, 200);
  const samples: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    t.set(`it_${String(i + 3).padStart(5, "0")}`, { title: `Edited ${i}` });
    const w = win(q);
    const rows = w.rows(0, 200);
    samples.push(performance.now() - t0);
    assert.equal(rows[i + 3]?.title, `Edited ${i}`);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
  assert.equal(calls, 30, "one notification per change");
  assert.ok(p95 < 16, `window update p95 ${p95.toFixed(2)} ms is over one frame (16 ms)`);
  const after = win(q).rows(0, 200);
  assert.strictEqual(after[100], before[100], "an untouched row is the same object");
  assert.notStrictEqual(after[3], before[3]);
  assert.equal(client.stats().listRebuilds, 0, "a title edit never re-ran the 10k-row ids query");
});

test("a change that moves a row, removes it or adds one rebuilds the ids and nothing else", () => {
  const t = setup();
  const client = createQueryClient(t.store);
  const q = client.list(t.def, { open: 1 });
  let calls = 0;
  q.subscribe(() => calls++);
  assert.equal(win(q).rows(0, 3)[0]?.id, "it_00000");

  t.set("it_00005", { rank: -1 });
  assert.equal(win(q).rows(0, 1)[0]?.id, "it_00005", "a row whose sort key changed moves");
  t.set("it_00005", { open: 0 });
  assert.equal(win(q).count, ROWS - 1, "a row that stopped matching leaves");
  t.set("it_00005", { open: 1, rank: ROWS + 5 });
  assert.equal(win(q).count, ROWS, "and comes back where its key says");
  t.add("it_new", "Brand new", -5);
  assert.equal(win(q).rows(0, 1)[0]?.id, "it_new");
  t.remove("it_new");
  assert.equal(win(q).count, ROWS);
  const before = calls;
  t.add("it_closed", "Closed one", 3, 0);
  t.set("it_closed", { title: "Closed one, edited" });
  assert.equal(calls, before, "a row that never matched this list is ignored, even when it changes again");
  assert.equal(client.stats().listRebuilds >= 4, true);
});

test("a list holds one feed subscription however many rows are drawn", () => {
  const t = setup();
  const client = createQueryClient(t.store, { windowRows: 300 });
  const q = client.list(t.def, { open: 1 });
  q.subscribe(() => {});
  win(q).rows(0, 200);
  assert.equal(t.changes.listeners(), 1);
  assert.equal(client.stats().feedListeners, 1);
  win(q).rows(5000, 5400);
  const w = win(q);
  assert.equal(w.rows(5000, 5400).length, 400);
  assert.equal(w.row("it_00000"), undefined, "rows far from the window are dropped past the cache limit");
});

test("lists of different Spaces and inputs are separate entries", () => {
  const t = setup();
  const client = createQueryClient(t.store);
  const a = client.list(t.def, { open: 1 });
  const b = client.list(t.def, { open: 0 });
  assert.equal(win(a).count, ROWS);
  assert.equal(win(b).count, 0);
  assert.equal(client.stats().entries, 2);
});
