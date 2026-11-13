// Nothing changes for an outside agent (lane f-guest, 13 Nov 2026): Simba (Claude Code) acting for the owner over MCP, in a public channel, in an invite-only channel it is added to, and in one the owner is not in. The table
// is what rc.26 answered before a channel's chat and reply threads moved under the channel for access; it must come back the same. VYRE_MATRIX_OUT writes the table as it was read.
import assert from "node:assert/strict";
import fs from "node:fs";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace } from "./support/outside-client.ts";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } };

withOutsideSpace(
  "an outside agent gets the same reads, posts, reply threads and search in a public channel, an invite-only channel it is in, and one it is not in",
  async (s, owner, mcp) => {
    const c = new Client(mcp, {}, "Simba (Claude Code)");
    const { agentId: simba } = await signIn(s, c, owner, { setup: true });
    await c.rpc("initialize", INIT);
    const noah = s.signedIn("usr_noah");
    const mk = async (who: string, name: string, visibility: "public" | "invite", agentIds: string[]) =>
      expectStatus(
        await s.call("channels.create", who, {
          name,
          visibility,
          memberIds: who === owner ? ["usr_noah"] : ["usr_olivia"].slice(0, 0),
          agentIds,
          idempotencyKey: `mx-${name}`,
        }),
        200,
        "channels.create",
      ).channel as Json;
    const chans: Record<string, Json> = {
      "public, agent in it": await mk(owner, "pubin", "public", [simba]),
      "invite, agent in it": await mk(owner, "privin", "invite", [simba]),
      "invite, owner not in it": await mk(noah, "privout", "invite", []),
    };
    const first: Record<string, string> = {},
      reply: Record<string, string> = {};
    for (const [k, ch] of Object.entries(chans)) {
      const who = k === "invite, owner not in it" ? noah : owner;
      const p = expectStatus(
        await s.call("chat.post", who, {
          threadId: ch.mainThreadId,
          body: `zebramark ${k}`,
          idempotencyKey: `mxp-${k}`,
        }),
        200,
        "chat.post",
      );
      first[k] = (p.messageId ?? p.message?.messageId ?? p.message?.id) as string;
      reply[k] = expectStatus(
        await s.call("chat.thread", who, { threadId: ch.mainThreadId, messageId: first[k] }),
        200,
        "chat.thread",
      ).thread.threadId as string;
    }
    const verdict = (r: { json: Json }): string => {
      const text = JSON.stringify(r.json.result ?? r.json.error ?? r.json);
      if (r.json.result?.isError !== true && !r.json.error) return "ok";
      return /((permission|validation|internal)\.[a-z_]+)/.exec(text)?.[1] ?? "error";
    };
    const table: Record<string, Record<string, string>> = {};
    let n = 0;
    for (const [k, ch] of Object.entries(chans)) {
      const use = (name: string, args: Json) =>
        c.tool("use_tool", { name, arguments: { idempotencyKey: `mxa-${n++}`, ...args } });
      const cell: Record<string, string> = {};
      cell["read.get"] = verdict(await use("threads_get", { threadId: ch.mainThreadId }));
      cell["read.messages"] = verdict(await use("chat_messages_list", { threadId: ch.mainThreadId }));
      cell["post"] = verdict(
        await c.tool("chat_post", { threadId: ch.mainThreadId, body: `agent ${n}`, idempotencyKey: `mxa-${n++}` }),
      );
      cell["reply.open"] = verdict(await use("chat_thread", { threadId: ch.mainThreadId, messageId: first[k] }));
      cell["reply.get"] = verdict(await use("threads_get", { threadId: reply[k] }));
      cell["reply.post"] = verdict(
        await c.tool("chat_post", { threadId: reply[k], body: `agent reply ${n}`, idempotencyKey: `mxa-${n++}` }),
      );
      const found = await use("chat_history_search", { q: `zebramark ${k}` });
      cell["search"] =
        verdict(found) +
        (verdict(found) === "ok" && JSON.stringify(found.json).includes(`zebramark ${k}`) ? "+finds" : "");
      table[k] = cell;
    }
    if (process.env["VYRE_MATRIX_OUT"])
      fs.writeFileSync(process.env["VYRE_MATRIX_OUT"], JSON.stringify(table, null, 1) + "\n");
    // rc.26's own answers (search is not an MCP tool here, so it errors the same way before and after)
    assert.deepEqual(
      table,
      JSON.parse(fs.readFileSync(new URL("./guest.channel.matrix.agent.rc26.json", import.meta.url), "utf8")),
      "the table differs from what rc.26 answered",
    );
  },
);
