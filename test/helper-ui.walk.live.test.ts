// r42-subagents on a booted daemon, only the model scripted: what the helper UI reads from the real runtime. (1) A helper told to start after another is queued; the node the UI reads, named the way the strip names it, gives
// "Starts when Alpha is done", and the line is gone once it has started. (2) A finished helper saved as an agent with edited instructions: the saved agent's own AGENT.md holds the edited text, not the first brief.
import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  connect,
  makeAgent,
  ok,
  scriptedModel,
  seededDir,
  startChat,
  stop,
  waitFor,
} from "./support/eco-live.ts";
import { nodesOf } from "../apps/app/src/places/chats/crew/run/reads.ts";
import { nameStandIns } from "../apps/app/src/places/chats/crew/run/model.ts";
import { toRunView } from "../apps/app/src/places/chats/crew/run-view.ts";

test("a queued helper reads as 'Starts when Alpha is done' from the real nodes, then starts; an edited brief is what the saved agent holds", async () => {
  let release!: () => void;
  const alphaGo = new Promise<void>((r) => (release = r));
  const model = scriptedModel(async function* (input) {
    const body = String(input.trigger?.body ?? "");
    if (/HOLD/.test(body)) await new Promise<void>(() => undefined);
    if (body.includes("ALPHA")) {
      await alphaGo;
      yield { type: "text", text: "alpha done" };
    } else if (body.includes("BETA")) yield { type: "text", text: "beta done" };
    else if (body.includes("GAMMA")) {
      yield { type: "error", code: "model.failed", message: "gamma could not finish" };
      return;
    }
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    const agent = await makeAgent(d, "Lead");
    const chat = await startChat(d, agent, "hu");
    await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "hu-auto" });
    await ok(d, "chat.post", {
      threadId: chat,
      body: "HOLD the job",
      mentions: [{ kind: "agent", id: agent }],
      idempotencyKey: "hu-hold",
    });
    const lead = await waitFor(async () => {
      const rows = (await ok(d, "runs.activity.list", {})).rows as Array<{
        runId: string;
        kind: string;
        status: string;
      }>;
      return rows.find((r) => r.kind === "turn" && r.status === "running") ?? null;
    }, 20_000);
    const start = (title: string, instruction: string, dependsOn?: string[]) =>
      ok(d, "chat.helper.start", {
        threadId: chat,
        title,
        instruction,
        agentId: agent,
        ...(dependsOn ? { dependsOn } : {}),
        idempotencyKey: `hu-${title}`,
      });
    // what the Crew strip and the tiles do: the members the daemon lists, the nodes it serves, the stand-ins named from the members, then the line
    const seen = async (title: string) => {
      const crew = (await ok(d, "engine.crew.status", { threadId: chat })) as {
        members: Array<{ id: string; title: string; name?: string; runId?: string; state: string }>;
      };
      const titles = new Map(crew.members.map((m) => [m.id, (m.name ?? m.title).trim()] as const));
      const nodes = nameStandIns(nodesOf(await ok(d, "runs.tree.get", { runId: lead.runId })), titles);
      const m = crew.members.find((x) => x.title === title || x.name === title);
      const view = m ? toRunView(m as never, nodes) : undefined;
      return { node: nodes.find((n) => n.name === title), line: view?.dependsLine, view };
    };

    // what the daemon served at each moment, for the pictures (HELPER_CAPTURE names the file; the shots mount reads it)
    const cap: Record<string, unknown> = {};
    const grab = async (label: string): Promise<void> => {
      cap[label] = {
        members: ((await ok(d, "engine.crew.status", { threadId: chat })) as { members: unknown[] }).members,
        nodes: (await ok(d, "runs.tree.get", { runId: lead.runId })).nodes,
      };
    };
    await start("Alpha", "ALPHA: add the figures");
    await waitFor(async () => ((await seen("Alpha")).node?.status === "running" ? true : null), 20_000);
    await start("Beta", "BETA: write it up", ["Alpha"]);
    const waiting = await waitFor(async () => {
      const s = await seen("Beta");
      return s.node?.status === "queued" ? s : null;
    }, 20_000);
    assert.equal(waiting.line, "Starts when Alpha is done", "the line, from the real nodes");
    await grab("waiting");
    release();
    await waitFor(async () => ((await seen("Beta")).node?.status === "succeeded" ? true : null), 30_000);
    assert.equal((await seen("Beta")).line, undefined, "once it has run there is no line");

    // a helper behind one that fails: what the UI reads for it (printed, then asserted below)
    await start("Gamma", "GAMMA: this one fails");
    await waitFor(async () => ((await seen("Gamma")).node?.status === "failed" ? true : null), 30_000);
    await start("Delta", "DELTA: after gamma", ["Gamma"]);
    // the host's sweep fails a helper behind failed work every few seconds: catch the moment before it, if there is one
    let cant: string | undefined;
    const delta = await waitFor(async () => {
      const s = await seen("Delta");
      if (s.node?.status === "queued" && s.line !== undefined && cant === undefined) {
        cant = s.line;
        await grab("cant-start");
      }
      return s.node && s.node.status !== "queued" && s.node.status !== "running" ? s : null;
    }, 30_000);
    if (cant !== undefined)
      assert.equal(cant, "Can't start: Gamma failed", "while it still stood queued behind the failed one");
    console.log("CANT-START-SEEN", cant !== undefined);
    await grab("failed");
    const dn = delta.node as { status: string; errorMessage?: string };
    console.log("DELTA", JSON.stringify({ status: dn.status, errorMessage: dn.errorMessage, line: delta.line }));
    assert.equal(dn.status, "failed", "it fails with the one it waited for");
    assert.equal(delta.line, undefined, "a failed helper shows no waiting line");
    const dv = (await seen("Delta")).view!;
    assert.equal(dv.state, "failed", "its tile is failed, not a working helper with a clock that keeps counting");
    assert.match(dv.lines[0] ?? "", /after Gamma, which did not finish/);
    assert.match((await seen("Gamma")).view!.lines[0] ?? "", /gamma could not finish/, "a failed helper says why");
    assert.match(String(dn.errorMessage), /after Gamma, which did not finish/, "and says which one it waited for");

    // save the finished Alpha as an agent with the instructions edited
    const alpha = (await seen("Alpha")).node!;
    const EDITED = "Add the figures and name the largest line first. EDITED-TEXT-42";
    await ok(d, "runs.node.save_as_agent", { runId: alpha.id, name: "Figures", instructions: EDITED, sharing: "me" });
    const agents = (await ok(d, "agents.list", {})) as {
      agents: Array<{ agentId: string; name: string; folderId: string }>;
    };
    const saved = agents.agents.find((a) => a.name === "Figures");
    assert.ok(saved, "the agent was made");
    const files = (await ok(d, "files.list", { folder: saved!.folderId })) as {
      files: Array<{ fileId: string; name: string }>;
    };
    const md = files.files.find((f) => f.name === "AGENT.md");
    assert.ok(md, "it has its AGENT.md");
    const text = String((await ok(d, "files.read", { fileId: md!.fileId, as: "text" })).text ?? "");
    assert.ok(text.includes("EDITED-TEXT-42"), "the edited text is what is stored");
    assert.ok(!text.includes("ALPHA: add the figures"), "and not the first brief");
    if (process.env["HELPER_CAPTURE"]) fs.writeFileSync(process.env["HELPER_CAPTURE"], JSON.stringify(cap, null, 1));
  } finally {
    await stop(d);
  }
});
