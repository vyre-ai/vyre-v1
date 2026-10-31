// The slash commands of a chat, run. The list itself is lib/chat-commands.ts (one list for the composer menu, the server's table and this code); a plugin adds its own on top and never replaces a
// name that is already taken. Every command here does something real or says why it could not: nothing is picked and then dropped.
import { CHAT_COMMANDS, chatCommand, parseSlash } from "../../../../../../lib/chat-commands.ts";
import type { ListItem } from "../../../../../../ui/src/Composer/index.tsx";
import * as act from "./actions.ts";
import { setChatMode } from "./brain.tsx";
import type { ConversationData, PluginCommand } from "./data.tsx";
import { mentionsIn } from "./model.ts";
import type { Message, Thread } from "./model.ts";
import type { ExportFormat } from "./export.ts";

/** What a command can reach: the chat, its messages, a way to speak to the person, and the controls only the screen owns. */
export interface CommandEnv {
  data: ConversationData;
  thread: Thread;
  /** Messages on the page, oldest first (pending ones left out). */
  rows: readonly Message[];
  say(text: string): void;
  newKey(): string;
  openFind(): void;
  openSearch(query: string): void;
  openModel(): void;
  /** Send a message as if typed (a plugin's prompt command). */
  send(text: string): void;
}

/** The list the composer offers after "/": ours first, then each plugin's that does not clash with a name already in use. */
export function commandItems(plugins: readonly PluginCommand[] = []): ListItem[] {
  const out: ListItem[] = CHAT_COMMANDS.map((c) => ({ t: c.id, s: c.detail, kind: "Command", body: c.id, ...(c.arg !== undefined ? { arg: c.arg } : {}) }));
  const taken = new Set(CHAT_COMMANDS.map((c) => c.id));
  for (const p of plugins) {
    const name = p.name.replace(/^\//, "").toLowerCase();
    if (name === "" || taken.has(name)) continue;
    taken.add(name);
    out.push({ t: name, s: p.description, kind: "Plugin", body: name, arg: "anything to add" });
  }
  return out;
}

export const pluginNames = (plugins: readonly PluginCommand[] = []): string[] => plugins.map((p) => p.name.replace(/^\//, "").toLowerCase());

/** If the text is a command we know, run it and return true; otherwise false and the caller sends it as a message. */
export async function runSlash(text: string, env: CommandEnv): Promise<boolean> {
  const plugins = env.data.pluginCommands?.() ?? [];
  const parsed = parseSlash(text, pluginNames(plugins));
  if (!parsed) return false;
  try {
    await run(parsed.id, parsed.arg, env, plugins);
  } catch (e) {
    env.say(failureLine(parsed.id, e));
  }
  return true;
}

const failureLine = (id: string, e: unknown): string => {
  const m = e instanceof Error ? e.message : "";
  if (m === act.OTHERS_LINE) return m;
  return m !== "" && m.length < 140 && !/^[a-z]+\.[a-z_]+$/.test(m) ? `/${id}: ${m}` : `/${id} did not work. Try again.`;
};

/** The newest message a person wrote or read that a command can act on. */
export function lastActionable(rows: readonly Message[]): Message | undefined {
  return [...rows].reverse().find((m) => (m.kind === "text" || m.kind === "agent") && m.body.trim() !== "");
}

async function run(id: string, arg: string, env: CommandEnv, plugins: readonly PluginCommand[]): Promise<void> {
  const { data, thread, rows, say } = env;
  const def = chatCommand(id);
  if (def?.argRequired && arg === "") { say(`/${id} needs ${def.arg ?? "a few words"}. For example: /${id} ${exampleFor(id)}`); return; }
  switch (id) {
    case "plan": {
      const want = /^(on|yes|start)$/i.test(arg) ? true : /^(off|no|stop)$/i.test(arg) ? false : !thread.planMode;
      await setChatMode(data, want ? "plan" : "ask");
      say(want ? "Plan mode is on: the agent plans and changes nothing until you approve" : "Plan mode is off");
      return;
    }
    case "helper": {
      const lead = thread.agents.find((a) => a.mode === "lead");
      const helperId = await act.startHelper(data, thread, arg, lead?.agentId);
      say("Helper started. It works on its own and reports back here.");
      data.nav.openThread(helperId);
      return;
    }
    case "handoff": {
      const named = mentionsIn(arg, data.directory.filter((c) => c.kind === "agent"))[0];
      if (!named) { say("Name the agent to hand it to: /handoff @Docs write the letter"); return; }
      const first = (data.nameOf(named.id).split(/\s+/)[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const note = arg.replace(new RegExp(`@${first}\\b`, "i"), "").replace(/\s+/g, " ").trim();
      if (note === "") { say(`Tell ${data.nameOf(named.id)} what to do: /handoff @${data.nameOf(named.id).split(/\s+/)[0]} the task`); return; }
      const next = await act.handOff(data, thread, named.id, note);
      say(`Handed to ${data.nameOf(named.id)}`);
      data.nav.openThread(next);
      return;
    }
    case "pin": {
      const m = lastActionable(rows);
      if (!m) { say("Nothing to pin yet"); return; }
      await act.setPinned(data, m.messageId, !m.pinned);
      say(m.pinned ? "Unpinned the last message" : "Pinned the last message");
      return;
    }
    case "fork": {
      const m = lastActionable(rows);
      const next = await act.forkChat(data, m?.messageId, env.newKey());
      say("Branched into a new chat, linked back to this one");
      data.nav.openThread(next);
      return;
    }
    case "export": {
      const format: ExportFormat = /json/i.test(arg) ? "json" : "md";
      const file = await act.exportChat(data, thread, format);
      if (data.saveFile) { data.saveFile(file.name, file.mime, file.content); say(`Saved ${file.name}: ${file.messages} ${file.messages === 1 ? "message" : "messages"}`); }
      else { data.copy(file.content); say(`Copied the chat as ${format === "json" ? "JSON" : "Markdown"}: ${file.messages} ${file.messages === 1 ? "message" : "messages"}`); }
      return;
    }
    case "continue": {
      if (!act.onlyMeHere(thread, data.me.id)) { say(act.OTHERS_LINE); return; }
      const spaces = data.elsewhere?.spaces ?? [];
      if (spaces.length === 0) { say("You are in no other Space on this device"); return; }
      const want = arg.trim().toLowerCase();
      const hit = spaces.find((x) => x.name.toLowerCase() === want) ?? spaces.find((x) => x.name.toLowerCase().startsWith(want));
      if (!hit) { say(`No Space named "${arg}". You can continue in: ${spaces.map((x) => x.name).join(", ")}`); return; }
      await act.continueElsewhere(data, thread, hit, data.spaceName ?? "another Space", env.newKey());
      say(`Continued in ${hit.name}. Open that Space and it is in your chats there.`);
      return;
    }
    case "task": {
      const m = lastActionable(rows);
      if (!m && arg === "") { say("Nothing to make a task from yet. Say what it is: /task call the court"); return; }
      const taskId = await act.makeTask(data, thread, m ?? { messageId: "", body: arg, author: { kind: "person", id: data.me.id }, createdAt: data.clock().now }, env.newKey(), arg);
      say("Task made from the last message");
      data.nav.openBeside("task", taskId);
      return;
    }
    case "remember": {
      const lead = thread.agents.find((a) => a.mode === "lead") ?? thread.agents[0];
      if (!lead) { say("Add an agent to this chat first. It keeps what you tell it to remember."); return; }
      const merged = await act.remember(data, thread, lead.agentId, arg);
      say(merged ? `${data.nameOf(lead.agentId)} will remember that` : `Sent to ${data.nameOf(lead.agentId)} to confirm before it is kept`);
      return;
    }
    case "find": env.openFind(); return;
    case "search": env.openSearch(arg); return;
    case "model": env.openModel(); return;
    case "stop": {
      await act.stopAll(data);
      say("Stopped. The steps so far are kept.");
      return;
    }
    default: {
      const p = plugins.find((x) => x.name.replace(/^\//, "").toLowerCase() === id);
      if (!p) { say(`/${id} is not a command here`); return; }
      if (p.run) { const line = await p.run(arg); if (line) say(line); return; }
      if (p.render) { env.send(await p.render(arg)); return; }
      if (p.prompt) { env.send(p.prompt.replaceAll("$ARGUMENTS", arg).trim()); return; }
      say(`/${id} has nothing to run`);
    }
  }
}

function exampleFor(id: string): string {
  switch (id) {
    case "helper": return "read the lease and list the dates";
    case "handoff": return "@Docs draft the cover letter";
    case "remember": return "I prefer short answers";
    default: return "...";
  }
}

