// Whose calls are these, over MCP? A session is minted for one person and every call through it acts for that person: a CLI engine's session for the person whose turn it serves (one session per person, never
// shared), an outside agent's for the person who connected it. A second token minted for another person acts for that person, and the first still acts for the first. A guard: if the server ever took the
// acting-for person from something else (the last caller, a header, the call's own input), these fail.
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../src/mcp/index.ts";
import type { McpCaller } from "../src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../src/tools/harness.ts";

const g = loadGenerated();
const PEOPLE = g.catalog.byName("people_status")?.cap ?? "people.status";
function rig(callers: Record<string, McpCaller>) {
  const fake = fakeInvoke(g.caps);
  const server = createMcpServer({
    catalog: g.catalog,
    defaults: g.defaults,
    invoke: fake.invoke,
    open: async (t) => callers[t] ?? null,
    now: () => 1_000_000,
  });
  let id = 0;
  const post = async (token: string, method: string, params?: unknown) =>
    server.handle({
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params === undefined ? {} : { params }) }),
    });
  return { fake, post };
}
const driver = (sessionId: string, person: string): McpCaller => ({
  kind: "driver",
  sessionId,
  space: "spc_1",
  principal: { kind: "agent", id: "agt_intake" },
  actingFor: person,
  threadId: "thr_chat",
  traceId: "a".repeat(32),
});
const outside = (sessionId: string, person: string): McpCaller => ({
  kind: "outside",
  sessionId,
  space: "spc_1",
  principal: { kind: "agent", id: "agt_outside" },
  actingFor: person,
  traceId: "b".repeat(32),
});

test("each session acts for the person it was minted for, however calls interleave: two CLI sessions in one chat and an outside agent", async () => {
  const { fake, post } = rig({
    tokA: driver("ses_a", "usr_maya"),
    tokB: driver("ses_b", "usr_jonas"),
    tokO: outside("ses_o", "usr_maya"),
  });
  for (const t of ["tokA", "tokB", "tokO"])
    await post(t, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "x", version: "1" },
    });
  // the same tool, in turn, one session after another, twice round
  for (const t of ["tokA", "tokB", "tokO", "tokB", "tokA", "tokO"])
    await post(t, "tools/call", { name: "people_status", arguments: {} });
  const by = fake.calls.filter((c) => c.cap === PEOPLE).map((c) => c.actingFor);
  assert.deepEqual(by, ["usr_maya", "usr_jonas", "usr_maya", "usr_jonas", "usr_maya", "usr_maya"]);
  assert.ok(fake.calls.every((c) => c.thread === undefined || c.thread === "thr_chat"));
});

test("what a call carries cannot change who it acts for: an acting-for person named in the input is ignored", async () => {
  const { fake, post } = rig({ tokB: driver("ses_b", "usr_jonas") });
  await post("tokB", "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "x", version: "1" },
  });
  await post("tokB", "tools/call", { name: "people_status", arguments: { actingFor: "usr_maya", asker: "usr_maya" } });
  assert.equal(fake.calls.find((c) => c.cap === PEOPLE)?.actingFor, "usr_jonas");
});
