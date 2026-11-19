// @tsx
// HOW FAST THE APP ANSWERS A PRESS (r41). A perf file (test/slow.json "perf": true): the numbers count only on the perf runners, each after a web export with Chromium (VYRE_APP_DIST), over the same link
// as test/first-load.perf.test.ts (24 Mbps, 20 ms). A Space with chats, files, records, notes and tasks is opened as its owner, and four things are timed:
//   home        the signed-in first screen: when the person's own rows are on the page (not the loading frame), on a first visit and on the next one; how long a loading frame was on screen; how far the page moved
//   switch      each place from the rail: the press to the next painted frame, to the frame the rail shows the place as open, and to the frame the place has drawn
//   rows        a chat from the sidebar, a file and a record from their lists: the same three times
//   back        Back and Forward across the last places: the same three times, and whether a scrolled list is where it was left
// Every time is the median of the runs. The budgets are at the end of the file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { holdKeyOnOwnNode } from "../client/src/gateway/local-key.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boot, scriptedModel, stop } from "./support/eco-live.ts";

/** Budgets in ms (medians). A press is answered inside 100 ms; the first screen shows the person's rows at once on a visit after the first. */
export const INSTANT_BUDGET_MS = {
  pressToPaint: 100,
  pressToHighlight: 100,
  homeAgainRows: 400,
  backToDrawn: 150,
} as const;
const LINK = { latency: 20, downloadThroughput: (24 * 1_000_000) / 8, uploadThroughput: 625_000 };
const median = (a: number[]): number =>
  a.length === 0 ? -1 : Math.round(a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]!);
const RUNS = Number(process.env["VYRE_INSTANT_RUNS"] ?? 5);

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Runs in the page before anything else: a frame-by-frame record of what is on screen, the browser's own press-to-paint times, and how far the layout moved. */
function probe(): void {
  const w = window as Any;
  const p = (w.__probe = {
    cls: 0,
    events: [] as Any[],
    frames: [] as Any[],
    loaf: [] as Any[],
    shifts: [] as Any[],
    seen: [] as string[],
    on: false,
    t0: 0,
    first: {} as Any,
  });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as Any[])
        if (!e.hadRecentInput) {
          p.cls += e.value;
          p.shifts.push({
            t: Math.round(e.startTime),
            v: Math.round(e.value * 1000) / 1000,
            nodes: (e.sources ?? []).slice(0, 4).map((x: Any) => {
              const n = x.node as Element | null;
              const named = n && n.nodeType === 1 ? (n.closest("[data-testid]") ?? n) : null;
              return `${named?.getAttribute?.("data-testid") ?? n?.nodeName ?? "?"} ${Math.round(x.previousRect.x)},${Math.round(x.previousRect.y)} ${Math.round(x.previousRect.width)}x${Math.round(x.previousRect.height)} > ${Math.round(x.currentRect.x)},${Math.round(x.currentRect.y)} ${Math.round(x.currentRect.width)}x${Math.round(x.currentRect.height)}`;
            }),
          });
        }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as Any[])
        p.events.push({ name: e.name, start: e.startTime, dur: e.duration, pe: e.processingEnd });
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as Any);
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as Any[])
        p.loaf.push({
          start: Math.round(e.startTime),
          dur: Math.round(e.duration),
          script: Math.round(e.renderStart - e.startTime),
          render: Math.round(e.styleAndLayoutStart - e.renderStart),
          layout: Math.round(e.startTime + e.duration - e.styleAndLayoutStart),
          scripts: (e.scripts ?? []).map(
            (x: Any) => `${x.invokerType}:${x.invoker}`.slice(0, 60) + ":" + Math.round(x.duration),
          ),
        });
    }).observe({ type: "long-animation-frame", buffered: true } as Any);
  } catch {
    /* an older browser: the frame record still answers */
  }
  const q = (s: string): Element | null => document.querySelector(s);
  const look = (): Any => {
    const stage = q('[data-testid="place-stage"]') as HTMLElement | null;
    const sel = q('[data-testid^="rail-"][data-testid$="-selected"]');
    return {
      t: performance.now(),
      sel: sel ? sel.getAttribute("data-testid")!.replace(/^rail-|-selected$/g, "") : "",
      swap: q("[data-swap]") !== null,
      // a loading frame the person can see: the launch surface (first-frame) is over the app until its first screen is usable, and what is under it then is not on screen
      loading:
        (q("[data-loading]:not([data-swap] [data-loading])") !== null ||
          q('[data-testid="chats-place-loading"]') !== null ||
          q('[data-testid="chats-sidebar-loading"]') !== null) &&
        q("[data-entry-first]:not([data-entry-fading]):not([data-entry-landing])") === null,
      rows: document.querySelectorAll('[data-testid^="row-c:"], [data-testid^="row-ch:"]').length,
      pending: q("[data-pending]") !== null,
      busy: document.documentElement.hasAttribute("data-nav-busy"),
      text: stage ? (stage.innerText ?? "").replace(/\s+/g, " ").slice(0, 400) : "",
      shell: q('[data-testid="shell"]') !== null,
    };
  };
  const tick = (): void => {
    const f = look();
    if (p.on) p.frames.push(f);
    // the page's own first times, from the start of the load
    if (f.shell && p.first.shell === undefined) p.first.shell = f.t;
    if (f.loading) {
      const which = [
        q("[data-loading]:not([data-swap] [data-loading])")
          ? `data-loading in ${q("[data-loading]")?.closest("[data-testid]")?.getAttribute("data-testid") ?? "?"}`
          : "",
        q('[data-testid="chats-place-loading"]') ? "chats-place-loading" : "",
        q('[data-testid="chats-sidebar-loading"]') ? "chats-sidebar-loading" : "",
      ]
        .filter((x) => x)
        .join("+");
      if (p.seen[p.seen.length - 1]?.split(" @")[0] !== which) p.seen.push(`${which} @${Math.round(f.t)}`);
    }
    if (f.loading && p.first.loading === undefined) p.first.loading = f.t;
    if (f.loading) p.first.loadingLast = f.t;
    if (f.rows > 0 && p.first.rows === undefined) {
      p.first.rows = f.t;
      p.first.clsAtRows = p.cls;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // a press starts a record; the press itself is the zero
  addEventListener(
    "pointerdown",
    () => {
      p.on = true;
      p.t0 = performance.now();
      p.frames = [];
      p.events = [];
    },
    true,
  );
  addEventListener(
    "keydown",
    () => {
      if (p.on) return;
      p.on = true;
      p.t0 = performance.now();
      p.frames = [];
      p.events = [];
    },
    true,
  );
}

interface Press {
  /** the press to the next painted frame (the browser's own measure of the click; 0 when it was under 16 ms) */
  paint: number;
  /** the press to the first frame that shows the answer (the rail's highlight on the place, or the row as open) */
  mark: number;
  /** the press to the frame the page asked for is drawn: nothing loading, no still copy over it */
  drawn: number;
  /** a frame between the press and the drawn page had an empty page or a loading sign on it */
  blank: boolean;
}

test("instant feel: a press is answered inside 100 ms, the first screen shows the person's rows at once, Back is instant", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (
      process.env["VYRE_REQUIRE_CHROME"] === "1" ||
      process.env["VYRE_PERF_RUN"] === "1" ||
      process.env["VYRE_PERF_FULL"] === "1"
    )
      assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const pw = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || pw.chromium.executablePath();
  assert.ok(fs.existsSync(exe), `a browser is required at ${exe}`);
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-instant-")));
  const d = await boot(
    fresh,
    scriptedModel(async function* () {
      /* no model turns in this walk */
    }),
    {
      appDir: path.resolve(dist),
      config: loadConfig(
        ["--data-dir", fresh, "--port", "0", "--space", "spc_instant", "--space-name", "Northwind"],
        {},
        "1.2.3",
      ),
    },
  );
  const browser = await pw.chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const PASSWORD = "instant feel password 4417";
    const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
    const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
    const made = await makeBundle(PASSWORD, "instant-recovery-code-1", { spaceId });
    const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        spaceId,
        displayName: "Imran Ibarra",
        username: "imran",
        password: PASSWORD,
        deviceName: "perf",
        deviceClass: "desktop",
        keys: {
          personKeyByPassword: made.personKeyByPassword,
          personKeyByRecovery: made.personKeyByRecovery,
          publicKey: made.publicKey,
          privateKeyWrapped: made.privateKeyWrapped,
          spaceKeys: made.spaceKeys ?? [],
        },
      }),
    });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const token = ((await claimed.json()) as { data: { session: { token: string } } }).data.session.token;
    assert.equal(await holdKeyOnOwnNode(d.url, token, made.personKey), true);
    let n = 0;
    const call = async (cap: string, input: Record<string, unknown>): Promise<Any> => {
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ idempotencyKey: `instant-${cap}-${++n}`, ...input }),
      });
      const j = (await r.json()) as { data?: unknown; error?: { message?: string } };
      if (r.status !== 200) throw new Error(`${cap}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
      return j.data;
    };
    const seedNotes: string[] = [];
    const tryCall = async (cap: string, input: Record<string, unknown>): Promise<Any> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await call(cap, input);
        } catch (e) {
          // the Space slows a burst of writes: wait and send it again
          if (/: 429 /.test(String(e)) && attempt < 30) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          seedNotes.push(String(e).slice(0, 200));
          return null;
        }
      }
    };
    for (const flow of ["team", "personal", "member"]) await tryCall("spaces.onboarding.seen", { flow });
    const me = (await call("identity.whoami", {})).principal.id as string;

    // a Space that has been used: eight channels (three with a page of lines), 40 files in two folders, a record type with 300 rows, notes and tasks
    const channels = ["planning", "deliveries", "questions", "suppliers", "returns", "billing", "hiring", "ideas"];
    for (const [at, name] of channels.entries()) {
      const ch = await tryCall("channels.create", { name, visibility: "public" });
      const threadId = ch?.channel?.mainThreadId;
      if (!threadId) continue;
      for (let m = 0; m < (at < 3 ? 14 : 3); m++)
        await tryCall("chat.post", {
          threadId,
          body: `Line ${m + 1} in ${name}: the delivery window, the open questions and who answers them. ${"More detail follows here. ".repeat(6)}`,
        });
    }
    const tree = await tryCall("files.tree", {});
    const root = (tree?.roots as Any[] | undefined)?.find((r) => r.kind === "folder" && r.folderId)?.folderId;
    for (const name of ["Plans", "Reports"]) {
      const folder = (await tryCall("files.folder.create", { parentId: root, name }))?.folder?.folderId;
      if (!folder) continue;
      for (let i = 0; i < 20; i++)
        await tryCall("files.create", {
          folderId: folder,
          name: `${name} ${i + 1}.md`,
          content: { text: `# ${name} ${i + 1}\n\n${"A line of the document. ".repeat(40)}\n` },
        });
    }
    await tryCall("schema.apply", {
      ops: [
        {
          op: "type.create",
          type: "rt_order",
          def: {
            title: "Order",
            plural: "Orders",
            icon: "table",
            titleField: "name",
            fields: [
              { key: "name", type: "text", title: "Name", required: true },
              { key: "city", type: "text", title: "City" },
              { key: "note", type: "text", title: "Note" },
            ],
          },
        },
      ],
    });
    await tryCall("records.bulk_upsert", {
      type: "rt_order",
      match: ["name"],
      createOnly: true,
      runAutomations: false,
      rows: Array.from({ length: 300 }, (_, i) => ({
        name: `Order ${i + 1}`,
        city: ["Lisbon", "Oslo", "Lima", "Osaka"][i % 4],
        note: `Packed and ready ${i + 1}`,
      })),
    });
    for (let i = 0; i < 8; i++)
      await tryCall("notes.create", { title: `Note ${i + 1}`, body: `Remember item ${i + 1}.` });
    for (let i = 0; i < 8; i++)
      await tryCall("tasks.create", { title: `Follow up ${i + 1}`, assigned: { kind: "person", id: me } });

    console.log(`INSTANT-SEED ${JSON.stringify(seedNotes.slice(0, 12))}`);
    const marker = (await call("spaces.get", {})).space.fingerprint as string;
    const session = {
      baseUrl: d.url,
      token,
      personId: me,
      marker,
      def: {
        spaceId,
        name: "Northwind",
        kind: "team",
        address: d.url,
        role: "Owner",
        tint: ["#6E5CF0", "#9B6BE8"],
        kit: "northwind",
        skinDefault: "system",
        starred: true,
        needsYou: false,
        console: true,
        terminal: false,
        counts: {},
        dots: {},
      },
    };

    const out: Record<string, Any> = { seedNotes: seedNotes.slice(0, 6) };
    const home = { rows: [] as number[], loadingMs: [] as number[], cls: [] as number[], usable: [] as number[] };
    const again = { rows: [] as number[], loadingMs: [] as number[], cls: [] as number[], usable: [] as number[] };
    const presses: Record<string, Press[]> = {};
    const note = (k: string, p: Press): void => void (presses[k] ??= []).push(p);

    for (let run = 0; run < RUNS; run++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((s: unknown) => {
        try {
          if (!localStorage.getItem("vyre.session.v1"))
            localStorage.setItem(
              "vyre.session.v1",
              JSON.stringify({ sessions: { [(s as { baseUrl: string }).baseUrl]: s } }),
            );
        } catch {
          /* blocked */
        }
      }, session);
      await ctx.addInitScript(probe);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...LINK });

      const reads: string[] = [];
      page.on("request", (r) => {
        const m = /\/v1\/(.+)$/.exec(new URL(r.url()).pathname);
        if (m) reads.push(m[1]!.replaceAll("/", "."));
      });
      // HOME: a first visit, then the same browser again
      for (const [v, into] of [
        [0, home],
        [1, again],
      ] as const) {
        await page.goto(`${d.url}/chats`, { waitUntil: "commit" });
        await page
          .waitForFunction(() => (window as Any).__probe?.first?.rows !== undefined, null, { timeout: 20_000 })
          .catch(async (e: unknown) => {
            await page.screenshot({ path: path.join(os.tmpdir(), "instant-fail.png") });
            console.log(`INSTANT-FAIL ${(await page.evaluate(() => document.body.innerText)).slice(0, 600)}`);
            throw e;
          });
        await page.waitForTimeout(v === 0 ? 2500 : 1500); // what the page keeps for the next visit is written after the screen has settled
        const f = await page.evaluate(() => {
          const p = (window as Any).__probe;
          const usable = performance.getEntriesByName("app.usable")[0]?.startTime ?? -1;
          return { ...p.first, cls: p.cls, usable, shifts: p.shifts, seen: p.seen };
        });
        if (process.env["VYRE_INSTANT_DEBUG"] === "1")
          console.log(`INSTANT-DBG home.${v} ${JSON.stringify({ ...f, reads: reads.splice(0) })}`);
        into.rows.push(f.rows);
        into.usable.push(f.usable);
        into.loadingMs.push(f.loading === undefined ? 0 : f.loadingLast - f.loading + 16);
        into.cls.push(Math.round((f.cls - 0) * 1000) / 1000);
      }

      /** One press and what followed it. `ready` says, in the page, that the thing asked for is drawn. */
      const press = async (
        key: string,
        act: () => Promise<void>,
        marked: string,
        ready: string,
        settle = 1200,
      ): Promise<void> => {
        await page.evaluate(() => {
          const p = (window as Any).__probe;
          p.on = false;
          p.frames = [];
          p.events = [];
        });
        await act();
        await page.waitForFunction(
          (sel: string) => {
            const el = document.querySelector(sel);
            return (
              el !== null &&
              document.querySelector("[data-swap]") === null &&
              document.querySelector("[data-loading]") === null
            );
          },
          ready,
          { timeout: 30_000 },
        );
        await page.waitForTimeout(settle);
        const r = await page.evaluate(
          ([m, rd]: string[]) => {
            const p = (window as Any).__probe;
            const frames = p.frames as Any[];
            const t0 = p.t0 as number;
            // the browser's own time from the press to the next paint: the click (or the key) that did the work
            const ev = (p.events as Any[]).filter((e) =>
              ["click", "pointerup", "keydown", "pointerdown"].includes(e.name),
            );
            const paint = ev.length === 0 ? 0 : Math.max(...ev.map((e) => e.dur));
            let mark = -1,
              drawn = -1,
              blank = false,
              sawBusy = false;
            for (const f of frames) {
              const hasMark = m.startsWith("sel:") ? f.sel === m.slice(4) : true;
              if (mark < 0 && hasMark) mark = f.t - t0;
              // the first frame is the answer to the press, never the page: a row's page starts after it
              if (!sawBusy && (f.busy || f.swap)) sawBusy = true;
              if (
                drawn < 0 &&
                hasMark &&
                !f.swap &&
                !f.busy &&
                !f.loading &&
                (sawBusy || f.t - t0 > 60) &&
                f.text.replace(/\s+/g, "").length >= 12
              )
                drawn = f.t - t0;
              if (drawn < 0 && !f.swap && (f.loading || f.text.replace(/\s+/g, "").length < 12)) blank = true;
            }
            void rd;
            p.on = false;
            const loaf = (p.loaf as Any[]).filter((x) => x.start + x.dur >= t0 && x.start <= t0 + 600);
            const evs = (p.events as Any[]).map((e) => `${e.name}@${Math.round(e.start - t0)}+${e.dur}`);
            return { paint, mark: Math.round(mark), drawn: Math.round(drawn), blank, loaf, t0: Math.round(t0), evs };
          },
          [marked, ready],
        );
        if (process.env["VYRE_INSTANT_DEBUG"] === "1") console.log(`INSTANT-DBG ${key} ${JSON.stringify(r)}`);
        note(key, { paint: r.paint, mark: r.mark, drawn: r.drawn, blank: r.blank });
      };
      const rail = async (place: string): Promise<void> => {
        const direct = page.locator(`[data-testid="rail-${place}"]`).first();
        if (
          !(await direct.isVisible().catch(() => false)) ||
          (await direct.evaluate((e) => (e.closest('[aria-hidden="true"]') ? 1 : 0))) === 1
        ) {
          await page.locator('[data-testid="rail-isle-more"]').click();
          await page.waitForTimeout(350);
        }
        await page.locator(`[data-testid="rail-${place}"]`).first().click();
      };

      // SWITCH: every place of the rail, first visit of each in this session, then each again
      const places: [string, string][] = [
        ["files", '[data-testid="place-stage"]'],
        ["records", '[data-testid="place-stage"]'],
        ["automations", '[data-testid="place-stage"]'],
        ["settings", '[data-testid="place-stage"]'],
        ["vault", '[data-testid="place-stage"]'],
        ["chats", '[data-testid="chats-sidebar"]'],
      ];
      for (const round of ["first", "again"]) {
        for (const [place, ready] of places) {
          if (
            (await page.locator(`[data-testid="rail-${place}"], [data-testid="rail-${place}-selected"]`).count()) === 0
          )
            continue;
          await press(`switch.${round}.${place}`, () => rail(place), `sel:${place}`, ready);
        }
      }

      // ROWS: channels and chats from the sidebar
      const rowIds = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="row-ch:"], [data-testid^="row-c:"]'))
          .map((e) => e.getAttribute("data-testid")!)
          .filter((id) => !/-(leading|suffix|marks|trailing|notelead)$/.test(id)),
      );
      out["rowIds"] = rowIds.slice(0, 12);
      for (const id of rowIds.slice(0, 5))
        await press(
          "row.chat",
          () => page.locator(`[data-testid="${id}"]`).first().click(),
          "",
          '[data-testid="place-stage"]',
          900,
        );

      // BACK and FORWARD across places and chats
      await press("switch.again.files", () => rail("files"), "sel:files", '[data-testid="place-stage"]');
      await press("switch.again.records", () => rail("records"), "sel:records", '[data-testid="place-stage"]');
      const backKey = async (fwd: boolean): Promise<void> => {
        const b = page.locator(`[data-testid="${fwd ? "nav-forward" : "nav-back"}"]`).first();
        if ((await b.count()) > 0) await b.click();
        else await page.keyboard.press(fwd ? "Alt+ArrowRight" : "Alt+ArrowLeft");
      };
      await press("back", () => backKey(false), "sel:files", '[data-testid="place-stage"]', 900);
      await press("back", () => backKey(false), "sel:chats", '[data-testid="chats-sidebar"]', 900);
      await press("forward", () => backKey(true), "sel:files", '[data-testid="place-stage"]', 900);
      await press("forward", () => backKey(true), "sel:records", '[data-testid="place-stage"]', 900);
      await ctx.close();
    }

    const sum = (list: Press[]): Record<string, number | boolean> => ({
      paint: median(list.map((p) => p.paint)),
      mark: median(list.map((p) => p.mark)),
      drawn: median(list.map((p) => p.drawn)),
      worstPaint: Math.max(...list.map((p) => p.paint)),
      blank: list.filter((p) => p.blank).length,
      n: list.length,
    });
    out["home"] = {
      rows: median(home.rows),
      usable: median(home.usable),
      loadingMs: median(home.loadingMs),
      cls: home.cls,
    };
    out["homeAgain"] = {
      rows: median(again.rows),
      usable: median(again.usable),
      loadingMs: median(again.loadingMs),
      cls: again.cls,
    };
    for (const [k, list] of Object.entries(presses)) out[k] = sum(list);
    console.log(`INSTANT ${JSON.stringify(out)}`);
    if (process.env["VYRE_INSTANT_REPORT"] === "1") return;

    const pressKeys = Object.keys(presses);
    for (const k of pressKeys) {
      const s = sum(presses[k]!);
      assert.ok(
        (s["paint"] as number) <= INSTANT_BUDGET_MS.pressToPaint,
        `${k}: the press was painted after ${s["paint"]} ms (over ${INSTANT_BUDGET_MS.pressToPaint})`,
      );
      if (k.startsWith("switch."))
        assert.ok(
          (s["mark"] as number) >= 0 && (s["mark"] as number) <= INSTANT_BUDGET_MS.pressToHighlight,
          `${k}: the rail showed the place after ${s["mark"]} ms (over ${INSTANT_BUDGET_MS.pressToHighlight})`,
        );
      assert.equal(s["blank"], 0, `${k}: a blank or loading frame was on screen between the press and the page`);
    }
    for (const k of ["back", "forward"]) {
      const s = sum(presses[k] ?? []);
      assert.ok(
        (s["drawn"] as number) >= 0 && (s["drawn"] as number) <= INSTANT_BUDGET_MS.backToDrawn,
        `${k}: the page it went to was drawn after ${s["drawn"]} ms (over ${INSTANT_BUDGET_MS.backToDrawn})`,
      );
    }
    assert.ok(
      median(again.rows) <= INSTANT_BUDGET_MS.homeAgainRows,
      `the first screen showed the person's rows after ${median(again.rows)} ms on a visit after the first (over ${INSTANT_BUDGET_MS.homeAgainRows})`,
    );
    assert.equal(median(again.loadingMs), 0, "a visit after the first drew a loading frame before the person's rows");
  } finally {
    await browser.close();
    await stop(d);
  }
});
