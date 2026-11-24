// Resources and prompts on a booted daemon, through the real sign-in (lane r42-mcp, 19 Nov 2026): a record the person made in Vyre is read by its address from the app they connected, the Space's
// skill is a prompt there, a thing that is not there is "not found", and each read is on the app's activity.
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace as withSpace } from "./support/outside-client.ts";

const SKILL = [
  "---",
  "name: weekly-report",
  "description: Write this week's report from tasks and records",
  "---",
  "1. Read the tasks closed this week.",
  "2. Write one page.",
  "",
].join("\n");

withSpace(
  "a record made in Vyre is read by its address from a connected app, and the Space's skill is a prompt there",
  async (s, owner, mcp) => {
    const c = new Client(mcp, {}, "Claude");
    const { agentId } = await signIn(s, c, owner);
    const made = expectStatus(
      await s.call("records.create", owner, {
        type: "contact",
        fields: { name: "Ada Lovelace" },
        idempotencyKey: "r42-res-1",
      }),
      200,
      "records.create",
    ).record as { id: string };
    expectStatus(
      await s.call("skills.add", owner, { text: SKILL, idempotencyKey: "r42-res-skill" }),
      200,
      "skills.add",
    );

    // what the app is offered, with no handshake
    const d = await c.ask("server/discover");
    assert.ok(d.json.result.capabilities.resources && d.json.result.capabilities.prompts, JSON.stringify(d.json));

    const list = await c.ask("resources/list");
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const uris = (list.json.result.resources as Array<{ uri: string }>).map((r) => r.uri);
    assert.ok(uris.includes("vyre://tasks/mine"));
    assert.ok(uris.includes("vyre://records/contact"), `the Space's record types are listed: ${uris.join(" ")}`);

    // the record, by its address
    const uri = `vyre://record/contact/${made.id}`;
    const got = await c.ask("resources/read", { uri });
    assert.equal(got.status, 200, JSON.stringify(got.json));
    const content = got.json.result.contents[0];
    assert.equal(content.uri, uri);
    assert.equal(JSON.parse(content.text).record.fields.name, "Ada Lovelace");

    // the newest records of the type
    const rows = await c.ask("resources/read", { uri: "vyre://records/contact" });
    assert.equal(rows.status, 200, JSON.stringify(rows.json));
    assert.match(rows.json.result.contents[0].text, /Ada Lovelace/);

    // not there, and an address of nothing this server has
    for (const bad of ["vyre://record/contact/rec_nothere", "vyre://vault/vlt_a1b2c3", "file:///etc/passwd"]) {
      const out = await c.ask("resources/read", { uri: bad });
      assert.equal(out.json.error?.code, -32602, bad);
      assert.equal(out.json.error.message, "Resource not found");
    }

    // the skill is a prompt, and getting it is the skill with the person's request
    const prompts = await c.ask("prompts/list");
    assert.equal(prompts.status, 200, JSON.stringify(prompts.json));
    const mine = (prompts.json.result.prompts as Array<{ name: string; description: string }>).find(
      (p) => p.name === "weekly-report",
    );
    assert.equal(mine?.description, "Write this week's report from tasks and records");
    const prompt = await c.ask("prompts/get", {
      name: "weekly-report",
      arguments: { request: "Keep it to five lines." },
    });
    assert.equal(prompt.status, 200, JSON.stringify(prompt.json));
    const text = prompt.json.result.messages[0].content.text as string;
    assert.match(text, /Read the tasks closed this week/);
    assert.match(text, /Request: Keep it to five lines\.$/);

    // what it read is on its activity, as a tool call is
    const did = expectStatus(await s.call("mcp.activity.list", owner, { agentId }), 200, "mcp.activity.list")
      .rows as Array<{ tool: string; outcome: string }>;
    assert.ok(
      did.some((r) => r.tool === "records_get" && r.outcome === "ok"),
      JSON.stringify(did),
    );
    assert.ok(
      did.some((r) => r.tool === "load_skill" && r.outcome === "ok"),
      JSON.stringify(did),
    );
    assert.ok(
      did.some((r) => r.tool === "records_get" && r.outcome === "error"),
      "the read of what is not there is there too",
    );
  },
  ["records", "automations", "events"],
);
