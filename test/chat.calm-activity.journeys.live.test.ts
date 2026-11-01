// The live line stays calm in the real app (Chrome, the production web export): over 15 s of a real turn that makes a tool call every quarter second, the mark is the same element the whole time (never
// remounted), no CSS animation restarts (animationstart stays near zero), the line's words change no more often than every 4 s, and the layout does not move. Light and dark, desktop.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";
import { shoot } from "./support/chat-shots.ts";
import { cli, connectSubscription } from "./support/cli-world.ts";

const OUT = "shots-evidence/chat-calm-activity";
// The daemon's shutdown does not close the CLI session, so the process ends 1.5 s after the journey with the code of its result.
let passes = 0;
let ran = false;
after(() => { if (ran) setTimeout(() => process.exit(passes === 1 ? 0 : 1), 1_500); });

test("calm activity line: one mark node, almost no animation restarts, words change at most every 4 s, no layout shift", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  ran = true;
  const s = await bootScreens({ kind: "personal", engineCli: cli }, env);
  const dir = `${OUT}/calm`;
  try {
    const w = s.world;
    await connectSubscription(w);
    const agent = (await w.owner.ok("agents.create", { name: "Haiku", role: "You answer briefly.", idempotencyKey: "ca-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "ca-chat" })).thread.threadId as string;
    await w.owner.ok("threads.set_mode", { threadId, mode: "auto", idempotencyKey: "ca-auto" });
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    const field = me.page.getByTestId("composer-field");
    await field.click();
    await field.fill("flurry 15");
    await me.page.getByTestId("composer-send").click();
    const mark = me.page.getByTestId("working-mark");
    await mark.waitFor({ timeout: 15_000 });

    // watch: tag the mark's node, count animationstart events, record the line's words and the row's box every 100 ms
    await me.page.evaluate(() => {
      const w = window as unknown as { __calm: { starts: string[]; words: Array<[number, string]>; boxes: string[]; node: Element | null } };
      const node = document.querySelector('[data-testid="working-mark"]');
      (node as unknown as { __tag: string }).__tag = "kept";
      w.__calm = { starts: [], words: [], boxes: [], node };
      document.addEventListener("animationstart", (e) => w.__calm.starts.push(`${(e.target as Element).className?.baseVal ?? (e.target as Element).className}:${e.animationName}`), true);
      const t0 = performance.now();
      setInterval(() => {
        const line = document.querySelector('[data-testid="activity-line"]') as HTMLElement | null;
        if (!line) return;
        const label = line.querySelector(".vy-fade")?.textContent ?? "";
        const last = w.__calm.words[w.__calm.words.length - 1];
        if (!last || last[1] !== label) w.__calm.words.push([Math.round(performance.now() - t0), label]);
        const r = line.getBoundingClientRect();
        w.__calm.boxes.push(`${Math.round(r.height)}@${Math.round(r.top)}`);
      }, 100);
    });
    await me.page.waitForTimeout(14_500);
    const r = await me.page.evaluate(() => {
      const c = (window as unknown as { __calm: { starts: string[]; words: Array<[number, string]>; boxes: string[]; node: Element | null } }).__calm;
      const now = document.querySelector('[data-testid="working-mark"]');
      return { starts: c.starts, words: c.words, same: now === c.node && (now as unknown as { __tag?: string })?.__tag === "kept", boxes: [...new Set(c.boxes.map((b) => b.split("@")[0]))] };
    });
    console.error("CALM", JSON.stringify({ starts: r.starts, words: r.words, same: r.same, heights: r.boxes }));
    assert.ok(r.same, "the mark is the same element after 15 s of fast tool calls");
    assert.ok(r.starts.every((x) => x.endsWith(":vy-fade")) && r.starts.length <= r.words.length, `animationstart is only the soft crossfade of a words change: ${r.starts.join(", ")}`);
    const gaps = r.words.slice(1).map((x, i) => x[0] - r.words[i]![0]);
    // the first word was already on screen before the watcher started, so its gap is not measured from its start
    assert.ok(gaps.slice(1).every((g) => g >= 3_800), `the line's words dwell at least 4 s: ${JSON.stringify(r.words)}`);
    assert.ok(r.words.length <= 5, `fewer than five changes in 15 s: ${r.words.length}`);
    assert.equal(r.boxes.length, 1, `the line never changes height: ${r.boxes.join(",")}`);
    // a theme switch restarts every CSS animation on the page, so the shots come after the measurement
    await shoot(me.page, dir, "after-flurry", { phone: false });
    passes += 1;
  } finally { await s.close(); }
});
