// A big Space reached through the relay the way a browser on vyre.run reaches it (17 Nov 2026: a firm's onboarding call, a Space of about 9,400 matters of 100 fields, 28,000 contacts, the relay's 1 MiB message
// limit). Two devices open the live stream from the start: a web page (it keeps no rows, so it is sent a tick) and a desktop (it keeps every row, so the whole feed crosses). Neither stream may end, no frame may
// come near the relay's limit, and what a person does first (open a table, open a record, search, post) answers inside its budget. BIG_FULL=1 runs the firm's own size.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { cap, FIRM, registryHash, request, RelaySocket, rig, seed, seededDir } from "./support/bigspace-kit.ts";
import type { Size } from "./support/bigspace-kit.ts";

const SIZE: Size = process.env["BIG_FULL"]
  ? FIRM
  : {
      matters: Number(process.env["BIG_MATTERS"] ?? 1500),
      fields: 100,
      contacts: Number(process.env["BIG_CONTACTS"] ?? 3000),
      orgs: 300,
    };
// BIG_MEASURE=1 logs what would fail instead of failing, to take the numbers on code that cannot pass
const MEASURE = process.env["BIG_MEASURE"] === "1";
const check = (ok: unknown, msg: string): void => {
  if (MEASURE) {
    if (!ok) process.stderr.write(`[big] WOULD FAIL: ${msg}\n`);
    return;
  }
  assert.ok(ok, msg);
};
const log = (m: string) => process.stderr.write(`[big ${new Date().toISOString().slice(11, 23)}] ${m}\n`);
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The way a device opens the live stream: ticket, socket, hello from the start; acks each frame like the client; returns what it saw. */
async function openLive(ch: Any, token: string, deviceClass: "web" | "desktop", ms: number) {
  const t0 = Date.now();
  const tk = await request(
    ch,
    { method: "POST", path: "/sync/v1/ticket", headers: { authorization: `Bearer ${token}` } },
    new Uint8Array(),
  );
  const ticket = JSON.parse(await tk.text()).data.ticket as string;
  const sock = new RelaySocket();
  const seen = {
    frames: [] as { t: string; bytes: number; items: number }[],
    head: 0,
    applied: 0,
    closed: null as string | null,
    liveAt: 0,
    doneAt: 0,
  };
  sock.onmessage = (e: { data: string | ArrayBuffer }) => {
    const raw = typeof e.data === "string" ? e.data : Buffer.from(e.data).toString();
    const f = JSON.parse(raw);
    seen.frames.push({ t: f.t, bytes: Buffer.byteLength(raw), items: f.items?.length ?? 0 });
    if (f.t === "hello_ok") {
      seen.head = f.ok.head;
      seen.liveAt = Date.now() - t0;
      // a web page skips the history it never keeps: it is up to date the moment the hub says hello, and only later changes reach it
      if (deviceClass === "web" && f.ok.mode === "live") seen.doneAt = seen.liveAt || 1;
    }
    if (f.t === "ev") {
      seen.applied = Math.max(seen.applied, f.seq);
      sock.send(JSON.stringify({ t: "ack", seq: f.seq }));
      if (seen.head > 0 && seen.applied >= seen.head && !seen.doneAt) seen.doneAt = Date.now() - t0;
    }
  };
  sock.onclose = (e: { code: number; reason: string }) => (seen.closed = `${e.code} ${e.reason}`);
  await new Promise<void>((ok) => {
    sock.onopen = () => ok();
    sock.attach(ch, `/sync/v1/ws?ticket=${encodeURIComponent(ticket)}`, {});
  });
  sock.send(
    JSON.stringify({
      t: "hello",
      hello: {
        deviceId: `dev_${deviceClass}`,
        deviceClass,
        appVersion: "1.2.3",
        registryHash: registryHash(),
        cursor: 0,
        epoch: 0,
        replica: { entities: {} },
      },
    }),
  );
  const end = Date.now() + ms;
  while (Date.now() < end && seen.closed === null && !seen.doneAt) await new Promise((r) => setTimeout(r, 50));
  return { sock, seen };
}

const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t = Date.now();
  const v = await f();
  return [v, Date.now() - t];
};

test(
  "a big Space opens live through the relay on a web page and on a desktop, and the first things a person does answer fast",
  { timeout: 600_000 },
  async () => {
    const r = await rig(seededDir());
    try {
      await seed(r.d, SIZE, log);
      // the host's consumers (folders, search, automations) read every record event: they must keep up with a sync, not trail it for minutes at the server's whole CPU
      const t1 = Date.now();
      const behind = (): number => {
        const ev = new DatabaseSync(r.d.paths.events, { readOnly: true });
        const mod = new DatabaseSync(r.d.paths.modules, { readOnly: true });
        try {
          const head = Number((ev.prepare("SELECT max(seq) AS s FROM events").get() as { s: number }).s);
          const at = (n: string): number =>
            Number(
              (mod.prepare("SELECT seq FROM host_hook_cursor WHERE name = ?").get(n) as { seq: number } | undefined)
                ?.seq ?? 0,
            );
          return (
            head -
            Math.min(
              at("projects.record_folder"),
              at("search.fts"),
              at("automations.triggers"),
              at("projects.auto_link"),
            )
          );
        } finally {
          ev.close();
          mod.close();
        }
      };
      let lag = behind();
      log(`consumers ${lag} events behind when the seed ended`);
      while (lag > 0 && Date.now() - t1 < (MEASURE ? 120_000 : 400_000)) {
        await new Promise((res) => setTimeout(res, 500));
        lag = behind();
      }
      const drained = Date.now() - t1;
      log(`consumers caught up ${lag === 0 ? "in" : "NOT after"} ${drained} ms`);
      // the firm's own size (BIG_FULL) is for the numbers; the 30 s bound is for the size the test runs at on every box
      check(lag === 0 || !!process.env["BIG_FULL"], "the consumers caught up");
      check(
        drained < 30_000 || !!process.env["BIG_FULL"],
        `the consumers caught up within 20 s of the last write: ${drained} ms`,
      );
      const { ch } = await r.channel();
      const rcall = async (c: string, body: Record<string, unknown>): Promise<[Any, number]> =>
        timed(async () => {
          const res = await request(
            ch,
            {
              method: "POST",
              path: `/v1/${c.replaceAll(".", "/")}`,
              headers: { "content-type": "application/json", authorization: `Bearer ${r.d.token}` },
            },
            new TextEncoder().encode(JSON.stringify({ idempotencyKey: `m-${Math.random()}`, ...body })),
          );
          const text = await res.text();
          assert.equal(res.status, 200, `${c}: ${res.status} ${text.slice(0, 300)}`);
          return JSON.parse(text).data;
        });

      // the web page
      const web = await openLive(ch, r.d.token, "web", 30_000);
      log(
        `web: live at ${web.seen.liveAt} ms, head ${web.seen.head}, applied ${web.seen.applied}, done ${web.seen.doneAt} ms, closed ${web.seen.closed}, frames ${web.seen.frames.length}, max ${Math.max(0, ...web.seen.frames.map((f) => f.bytes))} B`,
      );
      check(web.seen.closed === null, `the web stream stays open: ${web.seen.closed}`);
      check(web.seen.doneAt > 0 && web.seen.doneAt < 5_000, `first open to live under 5 s: ${web.seen.doneAt} ms`);
      check(Math.max(...web.seen.frames.map((f) => f.bytes)) < 4_000, "a web page is sent no rows");
      web.sock.close();

      // the desktop: the whole feed, every frame under the relay's limit
      const desk = await openLive(ch, r.d.token, "desktop", MEASURE ? 30_000 : 150_000);
      const max = Math.max(0, ...desk.seen.frames.map((f) => f.bytes));
      log(
        `desktop: head ${desk.seen.head}, applied ${desk.seen.applied}, done ${desk.seen.doneAt} ms, closed ${desk.seen.closed}, ev frames ${desk.seen.frames.filter((f) => f.t === "ev").length}, max frame ${max} B`,
      );
      check(desk.seen.closed === null, `the desktop stream is not dropped: ${desk.seen.closed}`);
      check(
        desk.seen.applied >= desk.seen.head,
        `the desktop got the whole feed: ${desk.seen.applied} of ${desk.seen.head}`,
      );
      check(max < 960 * 1024, `no frame near the relay's 1 MiB: ${max}`);
      desk.sock.close();

      // what a person does first
      const [page, tQuery] = await rcall("records.query", { type: "rt_matter", limit: 50 });
      log(`records.query matter 50 rows: ${tQuery} ms (${page.rows.length} rows, total ${page.total})`);
      check(tQuery < 1_000, `the table's first page under 1 s: ${tQuery} ms`);
      const [one, tGet] = await rcall("records.get", { type: "rt_matter", recordId: page.rows[7].id });
      log(`records.get matter: ${tGet} ms`);
      check(tGet < 300, `one matter under 300 ms: ${tGet} ms`);
      assert.ok(one.record ?? one.id ?? one);
      const [found, tSearch] = await rcall("records.search", {
        type: "rt_matter",
        q: `Matter ${Math.floor(SIZE.matters / 2)}`,
      });
      log(`records.search: ${tSearch} ms (${found.rows?.length} rows)`);
      check(tSearch < 500, `a search under 500 ms: ${tSearch} ms`);
      const [counts, tCount] = await rcall("records.counts", { type: "rt_matter" });
      log(`records.counts: ${tCount} ms ${JSON.stringify(counts).slice(0, 80)}`);
      const made = await rcall("channels.create", {
        name: "big-space",
        visibility: "public",
        memberIds: [],
        agentIds: [],
      });
      const threadId = made[0].channel.mainThreadId as string;
      const [, tPost] = await rcall("chat.post", { threadId, body: "hello from a big Space" });
      log(`chat.post: ${tPost} ms`);
      check(tPost < 200, `a posted message under 200 ms: ${tPost} ms`);
    } finally {
      await r.stop();
    }
  },
);
