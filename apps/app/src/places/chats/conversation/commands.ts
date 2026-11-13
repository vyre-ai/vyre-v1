// The slash commands of a chat, run. The list itself is lib/chat-commands.ts (one list for the composer menu, the server's table and this code); a plugin adds its own on top and never replaces a
// name that is already taken. Every command here does something real or says why it could not: nothing is picked and then dropped.
import { CHAT_COMMANDS, chatCommand, parseSlash } from "../../../../../../lib/chat-commands.ts";
import type { MyAi } from "../../../../../../lib/usage-text.ts";
import type { ListItem } from "../../../../../../ui/src/Composer/index.tsx";
import * as act from "./actions.ts";
import { notice, opens, usageCard } from "./command-result.ts";
import type { CommandResult } from "./command-result.ts";
import { compactChat, setChatMode } from "./brain.tsx";
import type { ConversationData, PluginCommand } from "./data.tsx";
import { mentionsIn } from "./model.ts";
import type { Message, Thread } from "./model.ts";
import type { ExportFormat } from "./export.ts";

/** What a command can reach: the chat, its messages, a place to put its result, and the controls only the screen owns. */
export interface CommandEnv {
  data: ConversationData;
  thread: Thread;
  /** Messages on the page, oldest first (pending ones left out). */
  rows: readonly Message[];
  /** Put a command's result where its kind says (command-result.ts). The screen owns the places. */
  show(result: CommandResult): void;
  newKey(): string;
  openFind(): void;
  openSearch(query: string): void;
  /** The Add sheet for this chat: a command that needs an agent opens it when the chat has none. */
  openAdd?(): void;
  /** Send a message as if typed (a plugin's prompt command). */
  send(text: string): void;
}

/** The list the composer offers after "/": ours first, then each plugin's that does not clash with a name already in use. */
export function commandItems(plugins: readonly PluginCommand[] = []): ListItem[] {
  const out: ListItem[] = CHAT_COMMANDS.map((c) => ({
    t: c.id,
    s: c.detail,
    kind: "Command",
    body: c.id,
    ...(c.arg !== undefined ? { arg: c.arg } : {}),
  }));
  const taken = new Set(CHAT_COMMANDS.map((c) => c.id));
  for (const p of plugins) {
    const name = p.name.replace(/^\//, "").toLowerCase();
    if (name === "" || taken.has(name)) continue;
    taken.add(name);
    out.push({ t: name, s: p.description, kind: "Plugin", body: name, arg: "anything to add" });
  }
  return out;
}

export const pluginNames = (plugins: readonly PluginCommand[] = []): string[] =>
  plugins.map((p) => p.name.replace(/^\//, "").toLowerCase());

/** If the text is a command we know, run it, show its result and return true; otherwise false and the caller sends it as a message. */
export async function runSlash(text: string, env: CommandEnv): Promise<boolean> {
  const plugins = env.data.pluginCommands?.() ?? [];
  const parsed = parseSlash(text, pluginNames(plugins));
  if (!parsed) return false;
  const again = async (): Promise<void> => {
    try {
      const r = await run(parsed.id, parsed.arg, env, plugins);
      if (r) env.show(r);
    } catch (e) {
      env.show(failure(parsed.id, e, again));
    }
  };
  await again();
  return true;
}

/** A failed command: plain words for the reason, and the same command to run again. */
function failure(id: string, e: unknown, retry: () => Promise<void>): CommandResult {
  const m = e instanceof Error ? e.message : "";
  const text =
    m === act.OTHERS_LINE
      ? m
      : m !== "" && m.length < 140 && !/^[a-z]+\.[a-z_]+$/.test(m)
        ? `/${id}: ${m}`
        : `/${id} did not work.`;
  return { kind: "notice", text, failed: { retry } };
}

/** The newest message a person wrote or read that a command can act on. */
export function lastActionable(rows: readonly Message[]): Message | undefined {
  return [...rows].reverse().find((m) => (m.kind === "text" || m.kind === "agent") && m.body.trim() !== "");
}

/** Run one command and answer what it ends in. `undefined`: it sent a message instead (a plugin's prompt), so there is no result. */
async function run(
  id: string,
  arg: string,
  env: CommandEnv,
  plugins: readonly PluginCommand[],
): Promise<CommandResult | undefined> {
  const { data, thread, rows } = env;
  const def = chatCommand(id);
  if (def?.argRequired && arg === "")
    return notice(`/${id} needs ${def.arg ?? "a few words"}. For example: /${id} ${exampleFor(id)}`);
  switch (id) {
    case "plan": {
      const was = thread.planMode === true;
      const want = /^(on|yes|start)$/i.test(arg) ? true : /^(off|no|stop)$/i.test(arg) ? false : !was;
      await setChatMode(data, want ? "plan" : "auto");
      return notice(want ? "Plan mode is on" : "Plan mode is off", {
        undo: async () => {
          await setChatMode(data, was ? "plan" : "auto");
        },
      });
    }
    case "permissions": {
      const rules = await act.readPermissions(data);
      // "/permissions remove 2" still works: it takes the rule back, with an Undo where the rule can be given again
      const pick = /^remove\s+(\d+)$/i.exec(arg.trim());
      if (pick) {
        const rule = rules[Number(pick[1]) - 1];
        if (!rule) return notice(`There is no rule ${pick[1]}. Say /permissions to see the list.`);
        await act.takeBack(data, rule);
        return notice(`Took back: ${act.permissionText(rule)}`, {
          ...(act.canGiveBack(rule, data.clock().now)
            ? {
                undo: async () => {
                  await act.giveBack(data, rule, data.clock().now);
                },
              }
            : {}),
        });
      }
      return {
        kind: "card",
        card: {
          kind: "permissions",
          rules: rules.map((r) => ({
            id: r.id,
            text: act.permissionText(r),
            ...(r.expiresAt !== undefined ? { until: r.expiresAt } : {}),
            restorable: act.canGiveBack(r, data.clock().now),
          })),
        },
      };
    }
    case "btw":
      return { kind: "card", card: { kind: "aside", question: arg } };
    case "usage": {
      // the words come from engine.my_ai (the one place that knows), never from the model
      const lead = thread.agents.find((a) => a.mode === "lead");
      const out = (await data.call("engine.my_ai", {
        threadId: thread.threadId,
        ...(lead ? { agentId: lead.agentId } : {}),
      })) as MyAi;
      return { kind: "card", card: usageCard(out) };
    }
    case "compact": {
      // the server says it in the chat in one line; only a server without engine.compact leaves it to this line
      const lead = thread.agents.find((a) => a.mode === "lead");
      const line = await compactChat(data, arg, false, lead?.agentId);
      return line === null ? notice(arg ? `Compacted, keeping ${arg}` : "Compacted") : opens();
    }
    case "helper": {
      const lead = thread.agents.find((a) => a.mode === "lead");
      const helperId = await act.startHelper(data, thread, arg, lead?.agentId);
      data.nav.openThread(helperId);
      return opens();
    }
    case "handoff": {
      const named = mentionsIn(
        arg,
        data.directory.filter((c) => c.kind === "agent"),
      )[0];
      if (!named) return notice("Name the agent to hand it to: /handoff @Docs write the letter");
      const first = (data.nameOf(named.id).split(/\s+/)[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const note = arg
        .replace(new RegExp(`@${first}\\b`, "i"), "")
        .replace(/\s+/g, " ")
        .trim();
      if (note === "")
        return notice(
          `Tell ${data.nameOf(named.id)} what to do: /handoff @${data.nameOf(named.id).split(/\s+/)[0]} the task`,
        );
      const next = await act.handOff(data, thread, named.id, note);
      data.nav.openThread(next);
      return opens();
    }
    case "pin": {
      const m = lastActionable(rows);
      if (!m) return notice("Nothing to pin yet");
      const was = m.pinned === true;
      await act.setPinned(data, m.messageId, !was);
      return notice(was ? "Unpinned the last message" : "Pinned the last message", {
        undo: async () => {
          await act.setPinned(data, m.messageId, was);
        },
      });
    }
    case "fork": {
      const m = lastActionable(rows);
      const next = await act.forkChat(data, m?.messageId, env.newKey());
      data.nav.openThread(next);
      return opens();
    }
    case "export": {
      const format: ExportFormat = /json/i.test(arg) ? "json" : "md";
      const file = await act.exportChat(data, thread, format);
      const n = `${file.messages} ${file.messages === 1 ? "message" : "messages"}`;
      if (data.saveFile) {
        data.saveFile(file.name, file.mime, file.content);
        return notice(`Saved ${file.name}: ${n}`);
      }
      data.copy(file.content);
      return notice(`Copied the chat as ${format === "json" ? "JSON" : "Markdown"}: ${n}`);
    }
    case "continue": {
      if (!act.onlyMeHere(thread, data.me.id)) return notice(act.OTHERS_LINE);
      const spaces = data.elsewhere?.spaces ?? [];
      if (spaces.length === 0) return notice("You are in no other Space on this device");
      const want = arg.trim().toLowerCase();
      const hit =
        spaces.find((x) => x.name.toLowerCase() === want) ?? spaces.find((x) => x.name.toLowerCase().startsWith(want));
      if (!hit) return notice(`No Space named "${arg}". You can continue in: ${spaces.map((x) => x.name).join(", ")}`);
      await act.continueElsewhere(data, thread, hit, data.spaceName ?? "another Space", env.newKey());
      return notice(`Continued in ${hit.name}. Open that Space and it is in your chats there.`);
    }
    case "task": {
      const m = lastActionable(rows);
      if (!m && arg === "") return notice("Nothing to make a task from yet. Say what it is: /task call the court");
      const taskId = await act.makeTask(
        data,
        thread,
        m ?? { messageId: "", body: arg, author: { kind: "person", id: data.me.id }, createdAt: data.clock().now },
        env.newKey(),
        arg,
      );
      data.nav.openBeside("task", taskId);
      return opens();
    }
    case "remember": {
      const lead = thread.agents.find((a) => a.mode === "lead") ?? thread.agents[0];
      if (!lead) {
        if (env.openAdd) {
          env.openAdd();
          return opens();
        }
        return notice("Add an agent to this chat first. It keeps what you tell it to remember.");
      }
      const merged = await act.remember(data, thread, lead.agentId, arg);
      return notice(
        merged
          ? `${data.nameOf(lead.agentId)} will remember that`
          : `Sent to ${data.nameOf(lead.agentId)} to confirm before it is kept`,
      );
    }
    case "find":
      env.openFind();
      return opens();
    case "search":
      env.openSearch(arg);
      return opens();
    case "model":
      return { kind: "menu", menu: "model" };
    case "stop": {
      // each stopped reply says so under itself
      await act.stopAll(data);
      return opens();
    }
    default: {
      const p = plugins.find((x) => x.name.replace(/^\//, "").toLowerCase() === id);
      if (!p) return notice(`/${id} is not a command here`);
      if (p.run) {
        const line = await p.run(arg);
        return line ? notice(line) : opens();
      }
      if (p.render) {
        env.send(await p.render(arg));
        return undefined;
      }
      if (p.prompt) {
        env.send(p.prompt.replaceAll("$ARGUMENTS", arg).trim());
        return undefined;
      }
      return notice(`/${id} has nothing to run`);
    }
  }
}

function exampleFor(id: string): string {
  switch (id) {
    case "helper":
      return "read the lease and list the dates";
    case "btw":
      return "what is the deadline again?";
    case "handoff":
      return "@Docs draft the cover letter";
    case "remember":
      return "I prefer short answers";
    default:
      return "...";
  }
}
