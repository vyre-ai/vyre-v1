// F51: who sees the steps of a turn in a shared chat. Alice (the asker), Bob (a member) and Gwen (a guest) share a private channel with one agent.
// Alice asks it to read a file only she can open and to use one of her Vault items; the stand-in model makes those calls through the real tool pipeline. What Bob and the guest are sent while it runs (their live
// socket) and what they can read afterwards (the stored reply) is printed and asserted: they may learn that work happened, never what it touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, connectClaude, join, PASSWORD } from "./member-key-kit.ts";
import { makeBundle } from "../client/src/crypto/keys.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const SECRET_NAME = "alice-private-notes.txt";
const SECRET_TEXT = "OLIVIA-ONLY-CONTENT-7731";
const VAULT_NAME = "Alice Bank Key";

test("steps of a turn in a shared chat: what the other readers see", { timeout: 240_000 }, async () => {
  let toolOut: string[] = [];
  let script: Array<{ tool: string; args: unknown }> = [];
  const model: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    let n = 0;
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        if (!String(input.trigger?.body ?? "").startsWith("probe")) {
          yield { type: "done" };
          return;
        }
        const call = async function* (
          tool: string,
          args: unknown,
        ): AsyncGenerator<DriverEvent, { ok: boolean; content: unknown }> {
          const id = `c${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name: tool, input: args };
          return p;
        };
        for (const s of script) {
          yield* call("tool_search", { query: s.tool });
          const r = yield* call(s.tool, s.args);
          toolOut.push(JSON.stringify(r.content).slice(0, 200));
        }
        // what a CLI engine reports for its own tools (agent/src/drivers/cli/session.ts): the call, its input detail (a path, a query), its result
        const cli: Array<[string, string, string]> = [
          ["x1", "Read", `/work/alice/${SECRET_NAME}`],
          ["x2", "Grep", SECRET_TEXT],
          ["x3", "Bash", `cat /work/alice/${SECRET_NAME}`],
        ];
        for (const [id, name, detail] of cli) {
          yield { type: "block", kind: "tool_call", payload: { id, name } } as DriverEvent;
          yield { type: "block", kind: "tool_input", payload: { id, detail } } as DriverEvent;
          yield {
            type: "block",
            kind: "tool_result",
            payload: { id, ok: true, detail: `2 passing\n1 failing: ${SECRET_TEXT}` },
          } as DriverEvent;
        }
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult(id: string, r: { ok: boolean; content: unknown }) {
        waiting.get(id)?.(r);
      },
      inject() {},
      async cancel() {},
      async close() {},
    } as EngineSession;
  };
  const d: Daemon = await boot(seededDir(), model);
  let k = 0;
  const ok = async (token: string, cap: string, input: Record<string, unknown>): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await api(d, token, cap, { idempotencyKey: `sr-${cap}-${++k}`, ...input });
    assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data).slice(0, 300)}`);
    return r.data;
  };
  let guestAdd = "";
  const tok: Record<string, string> = {};
  const frames: Record<string, Array<Record<string, any>>> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sockets: WebSocket[] = [];
  const listen = async (who: string): Promise<void> => {
    frames[who] = [];
    const ws = new WebSocket(`${d.url.replace(/^http/, "ws")}/sync/v1/ws`, {
      headers: { authorization: `Bearer ${tok[who]}` },
    } as never);
    sockets.push(ws);
    ws.addEventListener("message", (m) => {
      try {
        frames[who]!.push(JSON.parse(String(m.data)));
      } catch {
        /* not json */
      }
    });
    await new Promise<void>((res, rej) => {
      ws.addEventListener("open", () => res());
      ws.addEventListener("error", () => rej(new Error("socket")));
    });
    ws.send(
      JSON.stringify({
        t: "hello",
        hello: {
          deviceId: `dev_${who}`,
          deviceClass: "desktop",
          appVersion: "1.2.3",
          registryHash: "unknown",
          cursor: 0,
          epoch: 0,
          replica: { entities: {} },
        },
      }),
    );
  };
  try {
    const alice = await join(d, "alice");
    const bob = await join(d, "bob");
    tok["alice"] = alice.token;
    tok["bob"] = bob.token;
    await connectClaude(d, alice.token, "Alice Claude");
    const agent = (await ok(alice.token, "agents.create", { name: "Probe Helper", role: "You help." })).agent
      .agentId as string;
    // Alice's private file (her Personal folder) and a Vault item of hers (Mine)
    const tree = await ok(alice.token, "files.tree", {});
    const personal = tree.roots.find((r: { key: string }) => r.key === "personal").folderId as string;
    const file = await ok(alice.token, "files.create", {
      folderId: personal,
      name: SECRET_NAME,
      content: { text: SECRET_TEXT },
    });
    const fileId = file.file.fileId as string;
    const mine = await ok(alice.token, "vault.folders.create", { name: "Mine keys", scope: "mine" });
    await ok(alice.token, "vault.item.put", {
      folderId: mine.folder.id,
      name: VAULT_NAME,
      kind: "api_key",
      fields: [{ key: "api_key", value: "fake-bank-value" }],
    });
    const ch = await ok(alice.token, "channels.create", {
      name: "ops",
      visibility: "invite",
      memberIds: [bob.personId],
      agentIds: [agent],
    });
    const threadId = ch.channel.mainThreadId as string;
    // a guest of this channel only, invited by email and accepted with a real key bundle
    const inv = await ok(alice.token, "threads.invite_guest", { threadId, email: "gwen@example.test", level: "reply" });
    const made = await makeBundle(PASSWORD, "recovery-code-for-the-test", { spaceId: "spc_member_key" });
    const { personKey: _pk, ...rest } = made;
    const acc = await fetch(`${d.url}/v1/members/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!),
        username: "gwen",
        displayName: "gwen",
        password: PASSWORD,
        deviceName: "gwen's PC",
        deviceClass: "desktop",
        keys: {
          personKeyByPassword: rest.personKeyByPassword,
          personKeyByRecovery: rest.personKeyByRecovery,
          publicKey: rest.publicKey,
          privateKeyWrapped: rest.privateKeyWrapped,
          spaceKeys: rest.spaceKeys,
        },
      }),
    });
    assert.equal(acc.status, 200, await acc.clone().text());
    const accepted = ((await acc.json()) as { data: { token: string; personId: string } }).data;
    tok["gwen"] = accepted.token;
    const gid = accepted.personId;
    const addg = await api(d, alice.token, "channels.members.add", {
      channelId: ch.channel.channelId,
      personIds: [gid],
      level: "view",
      idempotencyKey: "sr-add-guest",
    });
    guestAdd = `${addg.status} ${JSON.stringify(addg.data).slice(0, 300)}`;
    // the guest becomes a member of the channel's chat when the join is handled: wait until they can open it, so what they are (not) sent means something
    await waitFor(
      async () => {
        await d.hooks?.pump?.();
        return (await api(d, tok["gwen"]!, "threads.get", { threadId })).status === 200 ? true : null;
      },
      30_000,
      () => hostLog(d),
    ).catch(() => undefined);
    const gl = await api(d, tok["gwen"]!, "channels.list", {});
    console.log(`GUEST channels.list ${gl.status} ${JSON.stringify(gl.data).slice(0, 300)}`);
    for (const who of ["alice", "bob", "gwen"]) await listen(who);
    await new Promise((r) => setTimeout(r, 500));
    script = [
      { tool: "files_read", args: { fileId } },
      { tool: "vault_use", args: { item: VAULT_NAME } },
    ];
    await ok(alice.token, "chat.post", {
      threadId,
      body: "probe read my file and use my bank key",
      mentions: [{ kind: "agent", id: agent }],
    });
    await waitFor(
      async () => {
        await d.hooks?.pump?.();
        return toolOut.length >= 2 ? true : null;
      },
      90_000,
      () => hostLog(d),
    );
    await new Promise((r) => setTimeout(r, 4000));
    await d.hooks?.pump?.();
    // a second turn that reads nothing of Alice's, so its reply is posted in the channel with the work it did
    toolOut = [];
    script = [];
    await ok(alice.token, "chat.post", {
      threadId,
      body: "probe again, nothing private",
      mentions: [{ kind: "agent", id: agent }],
    });
    await new Promise((r) => setTimeout(r, 6000));
    await d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 2000));
    // the asker's private Assistant brought into the group chat: Bob is in it too
    const mineList = await api(d, alice.token, "agents.list", {});
    const assistant = (
      (mineList.data as { agents?: Array<{ agentId: string; kind?: string; ownerId?: string }> }).agents ?? []
    ).find((a) => a.kind === "assistant");
    const assistantTried: Record<string, unknown> = { found: assistant?.agentId ?? null };
    const before = frames["bob"]!.length;
    if (assistant) {
      const add = await api(d, alice.token, "channels.agents.add", {
        channelId: ch.channel.channelId,
        agentId: assistant.agentId,
        idempotencyKey: "sr-assistant-add",
      });
      assistantTried["add"] = add.status;
      if (add.status === 200) {
        toolOut = [];
        script = [];
        await ok(alice.token, "chat.post", {
          threadId,
          body: "probe assistant read my notes",
          mentions: [{ kind: "agent", id: assistant.agentId }],
        });
        await new Promise((r) => setTimeout(r, 7000));
        await d.hooks?.pump?.();
        await new Promise((r) => setTimeout(r, 2000));
      } else assistantTried["why"] = JSON.stringify(add.data).slice(0, 200);
    }
    const dump: Record<string, unknown> = { toolOut, assistantTried };
    dump["bob assistant frames"] = frames["bob"]!.slice(before)
      .filter((f) => f["t"] === "turn")
      .map((f) => f["delta"]);
    const gt = await api(d, tok["gwen"]!, "threads.get", { threadId });
    for (const [cap, inp] of [
      ["channels.get", { channelId: ch.channel.channelId }],
      ["channels.stream", { channelId: ch.channel.channelId }],
      ["chat.messages.list", { threadId }],
      ["threads.get", { threadId }],
    ] as const) {
      const g = await api(d, tok["gwen"]!, cap, inp);
      dump[`guest ${cap}`] = `${g.status} ${JSON.stringify(g.data).slice(0, 6000)}`;
    }
    dump["guest add as channel member"] = guestAdd;
    dump["guest threads.get"] = `${gt.status} ${JSON.stringify(gt.data).slice(0, 900)}`;
    for (const who of ["bob", "gwen"]) {
      const turn = frames[who]!.filter((f) => f["t"] === "turn");
      dump[`${who} live frames`] = turn.map((f) => f["delta"]);
      // the replies live in the threads under the asking messages: the ids the turn frames name
      const places = [
        threadId,
        ...new Set(frames["bob"]!.filter((f) => f["t"] === "turn").map((f) => String(f["delta"].threadId))),
      ];
      dump[`${who} stored`] = [] as unknown[];
      for (const th of places) {
        const got = await api(d, tok[who]!, "chat.messages.list", { threadId: th });
        if (got.status !== 200) {
          (dump[`${who} stored`] as unknown[]).push(
            `${th}: status ${got.status} ${(got.data as { error?: { code?: string } })?.error?.code}`,
          );
          continue;
        }
        (dump[`${who} stored`] as unknown[]).push(
          ...(
            (got.data as { messages: unknown[] }).messages as Array<{
              author: { kind: string };
              body: string;
              blocks?: unknown[];
            }>
          ).map((m) => ({ in: th, by: m.author.kind, body: m.body, blocks: m.blocks })),
        );
      }
    }
    // the stored turn through the other doors: the transcript (also what search and the export read), the reply's turn info, and the turn's own record
    const finals = frames["bob"]!.filter((f) => f["t"] === "turn" && f["delta"].kind === "final");
    for (const who of ["bob", "alice"]) {
      for (const f of finals) {
        const th = String(f["delta"].threadId);
        const tr = await api(d, tok[who]!, "chat.transcript.read", { threadId: th });
        dump[`${who} transcript ${th.slice(-4)}`] = `${tr.status} ${JSON.stringify(tr.data).slice(0, 1500)}`;
        const info = await api(d, tok[who]!, "engine.turn.of_message", {
          threadId: th,
          messageId: String(f["delta"].messageId),
        });
        dump[`${who} turn info ${th.slice(-4)}`] = `${info.status} ${JSON.stringify(info.data).slice(0, 1500)}`;
        const rec = await api(d, tok[who]!, "engine.turn.get", { turnId: String(f["turn"]) });
        dump[`${who} turn record ${th.slice(-4)}`] = `${rec.status} ${JSON.stringify(rec.data).slice(0, 1500)}`;
      }
    }
    const aliceKeys = Object.keys(dump).filter((k) => k.startsWith("alice "));
    const aliceText = JSON.stringify(aliceKeys.map((k) => dump[k]));
    for (const k of aliceKeys) delete dump[k];
    const aliceFrames = JSON.stringify(frames["alice"]!.filter((f) => f["t"] === "turn"));
    assert.ok(aliceFrames.includes(SECRET_NAME), "the asker still sees what each step touched, live");
    const text = JSON.stringify(dump);
    console.log(`STEPS EVIDENCE ${text}`);
    if (process.env["STEPS_EVIDENCE"]) fs.writeFileSync(process.env["STEPS_EVIDENCE"], JSON.stringify(dump, null, 1));
    console.log(`ASKER SEES ${aliceText.slice(0, 3000)}`);
    // door by door: what each reader door told Bob (the guest cannot open the chat in this setup, so he is sent nothing live and reads nothing stored)
    const doors = Object.keys(dump).filter((k) => k !== "toolOut");
    const leaks = doors
      .map(
        (k) =>
          `${k}: ${[SECRET_NAME, SECRET_TEXT, VAULT_NAME, fileId].filter((x) => JSON.stringify(dump[k]).includes(x)).join(", ")}`,
      )
      .filter((l) => !l.endsWith(": "));
    assert.deepEqual(leaks, [], "what Bob was told names things only Alice may open");
  } finally {
    for (const ws of sockets) ws.close();
    await d.stop();
  }
});
