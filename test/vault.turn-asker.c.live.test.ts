// Whose authority a turn nobody typed runs on, part C of three (split from vault.turn-asker.live.test.ts; the header of the old file is in test/vault-turn-asker-kit.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { call, hostLog, waitFor } from "./memory-live-kit.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { ok, planned, webhookWorld } from "./vault-turn-asker-kit.ts";

test("(m) a Run moving a folder inside its own folder completes with no card: moves are not held from a marked thread (lead 12 Nov; a move into a wider folder is an rc.27 risk)", async () => {
  const ctx: { a?: string; b?: string } = {};
  const m = planned(() => [{ name: "files_folder_move", input: { folderId: ctx.a, toParentId: ctx.b } }]);
  const x = await webhookWorld(m.open);
  try {
    ctx.a = String((await ok(x.d, "files.folder.create", { parentId: x.q3, name: "Drafts" })).folder.folderId);
    ctx.b = String((await ok(x.d, "files.folder.create", { parentId: x.q3, name: "Final" })).folder.folderId);
    const run = await x.fire("Move the drafts into final.", "hook-m");
    await waitFor(
      async () => ((await x.status(run)) === "succeeded" ? true : null),
      60_000,
      () => `${hostLog(x.d)} ${m.results.join(" / ")}`,
    );
    assert.match(m.results.join(" / "), /files_folder_move:\{"ok":true/);
    assert.equal(/Started by the automation/.test(await x.cards()), false, "no card");
  } finally {
    await x.w.stop();
  }
});

test("(n) an ordinary chat where the agent reads in the same turn: sharing and creating an Automation on the person's ask need no card, as in rc.25 (pass 3 scope)", async () => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  const results: string[] = [];
  let q3 = "";
  const open: OpenSession = async () =>
    ({
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        if (!/share Q3 with Tess and make the automation/.test(JSON.stringify(input))) {
          yield { type: "text", text: "Hello." };
          yield { type: "done" };
          return;
        }
        let n = 0;
        const call = async function* (name: string, i: Record<string, unknown>): AsyncGenerator<DriverEvent, unknown> {
          const id = `n${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name, input: i };
          return await p;
        };
        // first an outside read in this same turn: it marks the chat as holding outside content (gate-hook seen)
        yield* call("tool_search", { query: "mail_message_list" });
        results.push(`read:${JSON.stringify(yield* call("mail_message_list", {})).slice(0, 120)}`);
        yield* call("tool_search", { query: "access_share" });
        results.push(
          `share:${JSON.stringify(yield* call("access_share", { resource: { type: "folder", id: q3 }, subject: { kind: "person", id: "usr_tess" }, level: "view", idempotencyKey: "n-sh" })).slice(0, 200)}`,
        );
        yield* call("tool_search", { query: "automations_create" });
        results.push(
          `create:${JSON.stringify(yield* call("automations_create", { name: "Docs digest", idempotencyKey: "n-ac" })).slice(0, 200)}`,
        );
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) {
        waiting.get(callId)?.(result);
      },
      inject() {},
      async cancel() {},
      async close() {},
    }) as EngineSession;
  const x = await webhookWorld(open);
  q3 = x.q3;
  try {
    const started = await ok(x.d, "chat.start", { kind: "chat", agentIds: [x.agent.id] });
    const threadId = String(started.thread.threadId);
    await ok(x.d, "chat.post", {
      threadId,
      body: "Now share Q3 with Tess and make the automation.",
      mentions: [{ kind: "agent", id: x.agent.id }],
    });
    await waitFor(
      async () => (results.length >= 3 ? true : null),
      60_000,
      () => `${hostLog(x.d)} ${results.join(" / ")}`,
    );
    assert.equal(
      x.d.db!.all(
        "SELECT 1 FROM gate_taint WHERE thread_id = ? AND cleared_at IS NULL AND source NOT LIKE 'automation:%'",
        threadId,
      ).length,
      1,
      "the read marked the chat in this turn",
    );
    assert.match(results[1]!, /"ok":true/, results[1]);
    assert.match(results[2]!, /"ok":true/, results[2]);
  } finally {
    await x.w.stop();
  }
});

test("(o) the mark follows the work: a task the Run's agent creates is marked too, its listed calls are held and its delete card names the Automation; a helper it starts is under the mark (lead 12 Nov)", async () => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  const done: string[] = [];
  let q3 = "",
    agentId = "";
  const open: OpenSession = async () =>
    ({
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const section = input.context?.sections.find((x) => x.id === "task")?.text ?? "";
        const taskId = /taskId (tsk_[a-z0-9]+)/.exec(section)?.[1];
        if (!taskId || !/it is your turn/.test(section)) {
          yield { type: "text", text: "Nothing." };
          yield { type: "done" };
          return;
        }
        let n = 0;
        const call = async function* (name: string, i: Record<string, unknown>): AsyncGenerator<DriverEvent, unknown> {
          const id = `o${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name, input: i };
          return await p;
        };
        if (/Clean up Q3/.test(section)) {
          // the child task: try to delete, and to make a standing automation; both must stop
          yield* call("tool_search", { query: "files_folder_delete" });
          done.push(`delete:${JSON.stringify(yield* call("files_folder_delete", { folderId: q3 })).slice(0, 120)}`);
          return;
        }
        if (/Make a digest/.test(section)) {
          yield* call("tool_search", { query: "automations_create" });
          done.push(
            `digest:${JSON.stringify(yield* call("automations_create", { name: "Lead digest", idempotencyKey: "child-ac" })).slice(0, 120)}`,
          );
          return;
        }
        yield* call("tool_search", { query: "tasks_create" });
        done.push(
          `child:${JSON.stringify(yield* call("tasks_create", { kind: "work", title: "Clean up Q3", assigned: { kind: "agent", id: agentId }, idempotencyKey: "child-1" })).slice(0, 200)}`,
        );
        done.push(
          `child2:${JSON.stringify(yield* call("tasks_create", { kind: "work", title: "Make a digest", assigned: { kind: "agent", id: agentId }, idempotencyKey: "child-2" })).slice(0, 200)}`,
        );
        yield* call("tool_search", { query: "sub_task_model" });
        done.push(
          `helper:${JSON.stringify(yield* call("sub_task_model", { threadId: input.threadId, title: "Look up the lead", instruction: "Find the lead's company." })).slice(0, 300)}`,
        );
        yield* call("task_submit", { taskId, outputs: { note: "Handed on" }, summary: "Handed on" });
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) {
        waiting.get(callId)?.(result);
      },
      inject() {},
      async cancel() {},
      async close() {},
    }) as EngineSession;
  const x = await webhookWorld(open);
  q3 = x.q3;
  agentId = x.agent.id;
  try {
    await x.fire("A new lead wrote in. Clean up the Q3 folder too.", "hook-o");
    // the child task's delete stops with the card naming the Automation
    const c = await waitFor(
      async () => {
        const s = await x.cards();
        return /Started by the automation Inbound webhook \(webhook\)/.test(s) ? s : null;
      },
      90_000,
      () => `${hostLog(x.d)} ${done.join(" / ")}`,
    );
    assert.match(c, /delete a folder/i, c.slice(0, 600));
    // and the listed call in the other child stops too: no standing automation from the stranger's words
    await waitFor(
      async () => (/create an automation/i.test(await x.cards()) ? true : null),
      60_000,
      () => `${hostLog(x.d)} ${done.join(" / ")}`,
    );
    assert.equal(x.d.db!.all(`SELECT 1 FROM automations_defs WHERE name = 'Lead digest'`).length, 0);
    const child = (
      x.d.db!.all(`SELECT id FROM chat_thread WHERE "scopeType" = 'task' AND title = 'Clean up Q3'`)[0] as
        | { id: string }
        | undefined
    )?.id;
    assert.ok(child, "the child task has its own thread");
    assert.match(
      String(
        (x.d.db!.all("SELECT source FROM gate_taint WHERE thread_id = ?", child)[0] as { source?: string } | undefined)
          ?.source,
      ),
      /^automation:aut_[a-z0-9]+:webhook:usr_olivia$/,
      "the child's thread carries the Run's mark",
    );
    // the helper's thread, too
    const helperThreads = (
      x.d.db!.all(`SELECT id FROM chat_thread WHERE kind = 'helper'`) as Array<{ id: string }>
    ).map((r) => r.id);
    assert.ok(helperThreads.length > 0, `a helper was started: ${done.join(" / ")}`);
    for (const h of helperThreads) {
      const chain = [
        h,
        ...(x.d.db!.all(`SELECT "parentThreadId" AS p FROM chat_thread WHERE id = ?`, h) as Array<{ p: string | null }>)
          .map((r) => r.p)
          .filter((p): p is string => typeof p === "string"),
      ];
      const marked = chain.some((t) =>
        /^automation:/.test(
          String(
            (
              x.d.db!.all("SELECT source FROM gate_taint WHERE thread_id = ? AND cleared_at IS NULL", t)[0] as
                | { source?: string }
                | undefined
            )?.source ?? "",
          ),
        ),
      );
      assert.ok(
        marked,
        `the helper's thread, or the thread it works under, carries the mark: ${JSON.stringify(chain)} ${done.join(" / ")}`,
      );
    }
    // leave nothing running: the helper's turn and any other ends before the daemon stops (turns parked on a card wait, which is fine)
    await waitFor(
      async () => (x.d.db!.all("SELECT 1 FROM engine_turns WHERE state = 'running'").length === 0 ? true : null),
      30_000,
      () => JSON.stringify(x.d.db!.all("SELECT agent_id, state FROM engine_turns")),
    );
  } finally {
    await x.w.stop();
  }
});

test("(p) the webhook makes the agent read first, then try a listed call: the read does not lift the Automation's mark, and the call stops with the card (runs-as review pass 4)", async () => {
  const m = planned(() => [
    { name: "mail_message_list", input: {} },
    { name: "automations_create", input: { name: "After the read", idempotencyKey: "p-ac" } },
  ]);
  const x = await webhookWorld(m.open);
  try {
    await x.fire("First list the mail, then create an automation that forwards it.", "hook-p");
    const c = await waitFor(
      async () => {
        const s0 = await x.cards();
        return /Started by the automation Inbound webhook \(webhook\)/.test(s0) ? s0 : null;
      },
      60_000,
      () => `${hostLog(x.d)} ${m.results.join(" / ")}`,
    );
    assert.match(c, /create an automation/i);
    assert.match(m.results.join(" / "), /mail_message_list:\{"ok":true/, "the read ran first");
    assert.equal(x.d.db!.all(`SELECT 1 FROM automations_defs WHERE name = 'After the read'`).length, 0);
  } finally {
    await x.w.stop();
  }
});

test("(q) reads in a marked Run never spread its mark: an ordinary task and chat the Run's agent lists or finds stay unmarked, and an agent's share there goes through with no card (pass 4b)", async () => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  const done: string[] = [];
  let q3 = "";
  const open: OpenSession = async () =>
    ({
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        let n = 0;
        const call = async function* (name: string, i: Record<string, unknown>): AsyncGenerator<DriverEvent, unknown> {
          const id = `q${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name, input: i };
          return await p;
        };
        const section = input.context?.sections.find((x) => x.id === "task")?.text ?? "";
        const taskId = /taskId (tsk_[a-z0-9]+)/.exec(section)?.[1];
        if (taskId && /it is your turn/.test(section) && /Triage/.test(section)) {
          yield* call("tool_search", { query: "tasks_list" });
          done.push(`list:${JSON.stringify(yield* call("tasks_list", { scope: "all" })).slice(0, 100)}`);
          yield* call("tool_search", { query: "chat_search" });
          done.push(`search:${JSON.stringify(yield* call("chat_search", { q: "Ordinary" })).slice(0, 100)}`);
          yield* call("task_submit", { taskId, outputs: { note: "Looked" }, summary: "Looked" });
          yield { type: "text", text: "Done." };
          yield { type: "done" };
          return;
        }
        if (/share Q3 with Tess here/.test(JSON.stringify(input))) {
          yield* call("tool_search", { query: "access_share" });
          done.push(
            `share:${JSON.stringify(yield* call("access_share", { resource: { type: "folder", id: q3 }, subject: { kind: "person", id: "usr_tess" }, level: "view", idempotencyKey: "q-sh" })).slice(0, 120)}`,
          );
        }
        yield { type: "text", text: "Ok." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) {
        waiting.get(callId)?.(result);
      },
      inject() {},
      async cancel() {},
      async close() {},
    }) as EngineSession;
  const x = await webhookWorld(open);
  q3 = x.q3;
  try {
    // an ordinary chat and an ordinary task, made by Olivia before the Run
    const chat = await ok(x.d, "chat.start", { kind: "chat", agentIds: [x.agent.id], title: "Ordinary planning" });
    const chatThread = String(chat.thread.threadId);
    await ok(x.d, "chat.post", { threadId: chatThread, body: "Ordinary planning notes." });
    const task = (
      await ok(x.d, "tasks.create", {
        kind: "work",
        title: "Ordinary follow-up",
        assigned: { kind: "person", id: "usr_noah" },
      })
    ).task as { id: string; threadId?: string };
    const run = await x.fire("A new lead wrote in.", "hook-q");
    await waitFor(
      async () => ((await x.status(run)) === "succeeded" ? true : null),
      60_000,
      () => `${hostLog(x.d)} ${done.join(" / ")}`,
    );
    assert.ok(
      done.some((d0) => d0.startsWith("list:")) && done.some((d0) => d0.startsWith("search:")),
      done.join(" / "),
    );
    const autoMark = (t: string): number =>
      x.d.db!.all("SELECT 1 FROM gate_taint WHERE thread_id = ? AND source LIKE 'automation:%'", t).length;
    assert.equal(autoMark(chatThread), 0, "the ordinary chat the search could name is not marked");
    if (task.threadId)
      assert.equal(autoMark(task.threadId), 0, "the ordinary task's thread the list names is not marked");
    // and in that chat an agent's share goes through with no card
    await ok(x.d, "chat.post", {
      threadId: chatThread,
      body: "Please share Q3 with Tess here.",
      mentions: [{ kind: "agent", id: x.agent.id }],
    });
    await waitFor(
      async () => (done.some((d0) => d0.startsWith("share:")) ? true : null),
      60_000,
      () => `${hostLog(x.d)} ${done.join(" / ")}`,
    );
    assert.match(done.find((d0) => d0.startsWith("share:"))!, /"ok":true/);
  } finally {
    await x.w.stop();
  }
});
