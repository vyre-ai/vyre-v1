// terminal.stream and the screen stream behind it (rc.44): the capability hands out the address (with no ticket in it) and a one-use ticket, the host spends it and joins the terminal's one watcher, the first message is
// the screen and later ones are numbered diffs sent when the terminal prints; a ticket is good once and only for its terminal; a host that draws no screen refuses with the plain reason.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, openScreen } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { codeOf, contractErrors, fakeHost, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let keys = 0;
const idem = (): string => `idem_stream_${++keys}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup(withScreen = true) {
  reset();
  const hn = harness();
  const f = fakeHost({ "echo hi": { exitCode: 0, output: "hi" } });
  const host = withScreen
    ? {
        ...f.host,
        capture: async (id: string) => ({
          text: (f.screens.get(id) ?? []).join("\n"),
          cols: 80,
          rows: 24,
          cursor: null,
          history: 0,
          hidden: false,
        }),
      }
    : f.host;
  bindHost(host as typeof f.host);
  return { hn, f };
}
const call = async (hn: Harness, cap: string, input: Record<string, unknown>): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const out = await h[cap]!(hn.ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap} output`);
  return out;
};

test("the capability answers an address with no ticket in it and a ticket; the host spends the ticket once and streams the screen as numbered changes", async () => {
  const { hn, f } = setup();
  const t = (await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: idem() }))
    .terminal;
  const s = await call(hn, "terminal.stream", { terminalId: t.terminalId });
  assert.equal(s.ws, `/terminals/${t.terminalId}/ws`);
  assert.ok(!s.ws.includes("ticket") && !s.ws.includes("?"));
  assert.ok(s.ticket.length >= 16);
  const got: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const view = await openScreen(
    hn.ctx.db as never,
    t.terminalId,
    s.ticket,
    undefined,
    hn.ctx.now(),
    (x) => void got.push(JSON.parse(x)),
  );
  assert.ok(view);
  assert.equal(got[0]!["t"], "screen");
  f.screens.set(t.terminalId, [...(f.screens.get(t.terminalId) ?? []), "$ echo hi", "hi"]);
  f.emitFrame(t.terminalId, "hi\n");
  await sleep(120);
  // a screen this small is sent whole: a change is a diff only when that is smaller than the screen
  const change = got.find((m) => m["rev"] === 1);
  assert.ok(change, "a numbered change was sent when the terminal printed");
  assert.match(String(change["text"]), /echo hi/);
  assert.equal(
    await openScreen(hn.ctx.db as never, t.terminalId, s.ticket, undefined, hn.ctx.now(), () => undefined),
    null,
    "a ticket opens once",
  );
  view!.stop();
  assert.equal(f.listeners(t.terminalId), 0, "the terminal is not watched when nobody watches");
});

test("a ticket is only for its own terminal, and a made-up ticket opens nothing", async () => {
  const { hn } = setup();
  const a = (await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: idem() }))
    .terminal;
  const b = (
    await call(hn, "terminal.open", {
      host: "agent_computer",
      agentId: "agt_intake",
      name: "second",
      idempotencyKey: idem(),
    })
  ).terminal;
  const s = await call(hn, "terminal.stream", { terminalId: a.terminalId });
  assert.equal(
    await openScreen(hn.ctx.db as never, b.terminalId, s.ticket, undefined, hn.ctx.now(), () => undefined),
    null,
  );
  assert.equal(
    await openScreen(hn.ctx.db as never, a.terminalId, "made-up", undefined, hn.ctx.now(), () => undefined),
    null,
  );
});

test("a host that draws lines and no screen refuses with the plain reason; an unknown terminal is not found", async () => {
  const { hn } = setup(false);
  const t = (await call(hn, "terminal.open", { host: "agent_computer", agentId: "agt_intake", idempotencyKey: idem() }))
    .terminal;
  try {
    await h["terminal.stream"]!(hn.ctx, { terminalId: t.terminalId });
    assert.fail("should refuse");
  } catch (e) {
    assert.equal(codeOf(e), "validation.precondition_failed");
  }
  try {
    await h["terminal.stream"]!(hn.ctx, { terminalId: "trm_nope" });
    assert.fail("should refuse");
  } catch (e) {
    assert.equal(codeOf(e), "validation.not_found");
  }
});
