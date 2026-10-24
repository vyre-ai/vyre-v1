// Lead and listen helpers (spec 2.5, 4.13, ARCH 6.5).
// route() in @vyre/lib decides who runs. These helpers only name the composer line,
// the default mode at thread creation, and the listener lines that go into the lead's context.
// A listener line is context. It is not an enqueue.

import type { EngineAgent, ThreadKind } from "./types.ts";

export function defaultMode(kind: ThreadKind, startedBy: "person" | "agent"): "lead" | "listen" {
  if (kind === "channel") return "listen";
  if (kind === "thread" && startedBy === "person") return "listen";
  if (kind === "chat" || kind === "ask") return "lead";
  if (startedBy === "agent") return "lead";
  return "listen";
}

export function replyLine(names: readonly string[]): string {
  if (names.length === 0) return "No agent will reply, type @ to ask one";
  if (names.length === 1) {
    const only = names[0] ?? "Agent";
    return `${only} will reply`;
  }
  return `${names.join(", ")} will reply`;
}

export function agentLabel(agent: EngineAgent): string {
  return agent.name ?? agent.id;
}

/** Identity and role line of every other agent. Listeners are named so the lead can see them. */
export function systemPrompt(agent: EngineAgent, agents: readonly EngineAgent[]): string {
  const lines = [`You are ${agentLabel(agent)}.`];
  for (const other of agents) {
    if (other.id === agent.id) continue;
    const name = agentLabel(other);
    if (other.mode === "listen") {
      lines.push(other.role ? `${name} is listening. ${other.role}.` : `${name} is listening.`);
    } else {
      lines.push(other.role ? `${name} is leading. ${other.role}.` : `${name} is leading.`);
    }
  }
  return lines.join("\n");
}
