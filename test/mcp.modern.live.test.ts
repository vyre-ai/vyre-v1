// The current MCP revision (2026-07-28) on a booted daemon, through the real sign-in (lane r42-mcp, 19 Nov 2026): an app that signs in and never says hello. Its first request works, a write lands as the
// agent acting for its person and shows under the app's name, the headers are checked, and an app of the older revision is served on the same address with the same sign-in.
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, MODERN as V, signIn, withOutsideSpace as withSpace } from "./support/outside-client.ts";

withSpace(
  "an app that signs in and never says hello: discover, the list and a first write all work, and the write is under the app's name",
  async (s, owner, mcp) => {
    const c = new Client(mcp, {}, "Cursor");
    const { agentId } = await signIn(s, c, owner);

    const d = await c.ask("server/discover");
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.equal(d.json.result.resultType, "complete");
    assert.equal(d.json.result.supportedVersions[0], V);
    assert.ok(d.json.result.supportedVersions.includes("2025-06-18"));
    assert.equal(d.headers["mcp-session-id"], undefined, "no session is handed out");

    const list = await c.ask("tools/list");
    assert.equal(list.status, 200);
    const names = (list.json.result.tools as Array<{ name: string }>).map((t) => t.name);
    assert.ok(
      names.includes("tool_search") && names.includes("use_tool"),
      "the two tools every other tool is reached with",
    );
    assert.deepEqual(names, [...names].sort());
    assert.equal(list.json.result.cacheScope, "private");

    // the first write, as a model does it: find the tool by what it wants to do, then call it by name. No key, no session, no list in between.
    const found = await c.ask("tools/call", { name: "tool_search", arguments: { query: "take a note" } });
    assert.equal(found.status, 200, JSON.stringify(found.json));
    assert.ok(
      (found.json.result.structuredContent.data.tools as Array<{ name: string }>).some(
        (t) => t.name === "notes_create",
      ),
      JSON.stringify(found.json.result.structuredContent),
    );
    const made = await c.ask("tools/call", {
      name: "use_tool",
      arguments: {
        name: "notes_create",
        arguments: { title: "Supplier prices", body: "Harbor Studio quoted 12 per unit." },
      },
    });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal(made.json.result.isError, false, JSON.stringify(made.json.result));
    assert.equal(made.json.result.resultType, "complete");
    const notes = expectStatus(await s.call("notes.list", owner, {}), 200, "notes.list").notes as Array<{
      title?: string;
    }>;
    assert.ok(
      notes.some((n) => n.title === "Supplier prices"),
      "the note is the person's own",
    );

    // what it did is on its activity, and the app is listed under the name it gave
    const did = expectStatus(await s.call("mcp.activity.list", owner, { agentId }), 200, "mcp.activity.list")
      .rows as Array<{
      tool: string;
      outcome: string;
    }>;
    assert.ok(did.some((r) => r.tool === "notes_create" && r.outcome === "ok"));
    const apps = expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list")
      .agents as Array<{
      agentId: string;
      clientName: string;
      calls: number;
    }>;
    assert.equal(apps.find((a) => a.agentId === agentId)?.clientName, "Cursor");
    assert.ok((apps.find((a) => a.agentId === agentId)?.calls ?? 0) >= 1);

    // headers that disagree with the body are refused before anything runs
    const lie = await c.ask(
      "tools/call",
      { name: "use_tool", arguments: { name: "notes_create", arguments: { title: "Never saved" } } },
      { "mcp-name": "tool_search" },
    );
    assert.equal(lie.status, 400);
    assert.equal(lie.json.error.code, -32020);
    const gone = await c.ask("ping");
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, -32601);

    // an app of the older revision, on the same address with the same sign-in
    const init = await c.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Cursor", version: "2.0" },
    });
    assert.equal(init.status, 200);
    assert.equal(init.json.result.protocolVersion, "2025-06-18");
    assert.equal((await c.tool("agents_next")).status, 200);

    // Remove ends both at once
    expectStatus(await s.call("mcp.connected.remove", owner, { agentId }), 200, "mcp.connected.remove");
    assert.equal((await c.ask("tools/list")).status, 401);
  },
  ["notes"],
);
