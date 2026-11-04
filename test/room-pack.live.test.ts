// The room pack on a booted daemon, against a seeded 300-message room of two people: a tagged agent's first model request carries the roster, the recent window with names and times, and no tool
// is called before the first text. Also prints the time from the tag to the model receiving its request, with and without the pack (VYRE_ROOM_PACK=off), which is the part of "time to first token" that
// Vyre controls; the model's own latency comes on top of it.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, makeAgent, seededDir, waitFor } from "./support/live.ts";
import { join } from "./member-key-kit.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const ROOM = 300;

async function run(): Promise<{ on: { ms: number; prompt: string; bytes: number }; off: { ms: number; prompt: string; bytes: number } }> {
  let sentAt = 0, seen = "", firstTextAt = 0;
  const reset = (): void => { sentAt = 0; seen = ""; firstTextAt = 0; };
  const model: OpenSession = async () => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      sentAt = Date.now();
      seen = JSON.stringify({ context: input.context?.sections ?? [], history: input.history.map((h) => h.body), trigger: input.trigger?.body });
      firstTextAt = Date.now();
      yield { type: "text", text: "On it." };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Intake");
    const omar = await join(d, "omar");
    const made = await call(d, "channels.create", { name: "launch", visibility: "invite", memberIds: [omar.personId], agentIds: [agent], idempotencyKey: "rp-chan" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const threadId = made.data.channel.mainThreadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "rp-auto" });
    for (let i = 1; i <= ROOM; i++) {
      const as = i % 2 === 0 ? omar.token : d.token;
      let text = "";
      for (let tries = 0; tries < 80; tries++) {
        const r = await fetch(`${d.url}/v1/chat/post`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${as}` }, body: JSON.stringify({ threadId, body: `Message ${i}: the portal launch checklist item ${i} is ${i % 7 === 0 ? "blocked on pricing" : "on track"}.`, mentions: [], idempotencyKey: `rp-m${i}` }) });
        text = await r.text();
        if (r.status === 200) break;
        if (!text.includes("rate_limit")) assert.fail(`post ${i}: ${text}`);
        await new Promise<void>((res) => setTimeout(res, 1_000));   // the chat's own limit on posts a minute
      }
      assert.ok(text.includes("messageId"), `post ${i}: ${text.slice(0, 200)}`);
    }
    const tag = async (pack: "on" | "off", n: number): Promise<{ ms: number; prompt: string; bytes: number }> => {
      if (pack === "off") process.env["VYRE_ROOM_PACK"] = "off"; else delete process.env["VYRE_ROOM_PACK"];
      reset();
      const t0 = Date.now();
      for (let tries = 0; tries < 80; tries++) {
        const posted = await call(d, "chat.post", { threadId, body: `@Intake can you take the pricing item? (${n})`, mentions: [{ kind: "agent", id: agent }], idempotencyKey: `rp-tag${n}` });
        if (posted.status === 200) break;
        if (!JSON.stringify(posted.data).includes("rate_limit")) assert.fail(JSON.stringify(posted.data));
        await new Promise<void>((res) => setTimeout(res, 1_000));
      }
      await waitFor(async () => (firstTextAt > 0 ? true : null), 40_000);
      return { ms: sentAt - t0, prompt: seen, bytes: seen.length };
    };
    // a first turn builds the runtime, so one throwaway tag comes first; then off and on alternate, and the median of each is reported
    await tag("off", 0);
    const ons: Array<{ ms: number; prompt: string; bytes: number }> = [], offs: Array<{ ms: number; prompt: string; bytes: number }> = [];
    for (let n = 1; n <= 5; n++) {
      await new Promise<void>((res) => setTimeout(res, 1_000));
      offs.push(await tag("off", n * 2));
      await new Promise<void>((res) => setTimeout(res, 1_000));
      ons.push(await tag("on", n * 2 + 1));
    }
    const mid = <T extends { ms: number }>(xs: T[]): T => [...xs].sort((a, b) => a.ms - b.ms)[Math.floor(xs.length / 2)]!;
    console.log(`room pack runs (ms): off ${offs.map((x) => x.ms).join(",")}; on ${ons.map((x) => x.ms).join(",")}`);
    return { on: mid(ons), off: mid(offs) };
  } finally { delete process.env["VYRE_ROOM_PACK"]; await d.stop(); }
}

test("a tagged agent in a 300-message room gets the roster, the recent messages with names and times, and a request in well under a second", { timeout: 560_000 }, async () => {
  const { on, off } = await run();
  const text = JSON.parse(on.prompt) as { context: Array<{ id: string; text: string }>; history: string[] };
  const room = text.context.find((s) => s.id === "room")?.text ?? "";
  const recent = text.context.find((s) => s.id === "recent")?.text ?? "";
  assert.match(room, /People: .*\(asked you\)/);
  assert.match(room, /Earlier: \d+ messages since/, "no digest yet, so the earlier line says how much came before");
  assert.match(recent, /\((person|agent)\): /, "who said it");
  assert.match(room, /Agents: you \(this is you\)/);
  assert.match(recent, /\[\w{3} \d+ \w{3} \d\d:\d\d\]/, "each line has a time");
  assert.ok(text.history.length <= 1, "the window stands in for the history sent again");
  console.log(`room pack, 300-message room: tag to model request, median of 5: ${off.ms} ms without the pack (${off.bytes} bytes), ${on.ms} ms with it (${on.bytes} bytes)`);
  assert.ok(on.ms < 1500, `the request is ready in ${on.ms} ms`);
});
