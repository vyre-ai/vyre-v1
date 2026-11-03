// The opening of an Ask or a chat: the title a ready-made first message gives its session, and the summary a person brings along from another chat. Shared by the Chats place and the
// Ask pane of every other place; no React here, so a plain test reads it.

/** The title of a session that starts from a ready-made first message (Add to Automations, Build a connector). The agent side loads the connector-builder skill for exactly these titles. */
export function openingTitle(first: string): string | undefined {
  const add = /^Add (.+?) to Automations\./.exec(first);
  if (add) return `Add ${add[1]} to Automations`;
  if (/^Build a connector\b/.test(first)) return "Build a connector";
  const sync = /^Sync (.+?) to Records\./.exec(first);
  if (sync) return `Sync ${sync[1]} to Records`;
  if (/^Bring my CRM into Records\./.test(first)) return "Bring my CRM into Records";
  const edit = /^Change how (.+?) syncs to Records\./.exec(first);
  if (edit) return `Change how ${edit[1]} syncs to Records`;
  return undefined;
}

/** What the person brings into an Ask from the chat they were in: its rolling summary and its last few messages, as one message. Null when there is nothing to bring. */
export async function broughtSummary(rt: { call(cap: string, input: unknown): Promise<unknown> }, threadId: string): Promise<string | null> {
  try {
    const sum = (await rt.call("chat.transcript.summary", { threadId })) as { summary?: string };
    const msgs = (await rt.call("chat.messages.list", { threadId })) as { messages?: Array<{ body: string; author: { kind: string } }> };
    const last = (msgs.messages ?? []).filter((m) => m.body.trim() !== "").slice(-6).map((m) => `${m.author.kind === "agent" ? "Agent" : "Me"}: ${m.body.replace(/\s+/g, " ").slice(0, 400)}`);
    const parts = [sum.summary?.trim() ? `Summary so far:\n${sum.summary.trim()}` : "", last.length > 0 ? `The last messages:\n${last.join("\n")}` : ""].filter((x) => x !== "");
    return parts.length === 0 ? null : `I am bringing this conversation with me, so you can carry on from it.\n\n${parts.join("\n\n")}`;
  } catch { return null; }
}
