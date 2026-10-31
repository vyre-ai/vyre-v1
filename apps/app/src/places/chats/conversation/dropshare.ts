// Drag a mounted folder or file from Files onto a chat (desktop): it is shared with that chat's agents, and a line under the chat says so with Undo (rc.8 live folders). Files drags carry
// "file:<id>" and "folder:<id>" joined by commas as text/plain. Agents get View, so they can read and list; a write goes through the Gate as for any change, and an agent that needs to write
// asks for more. Nothing is shared with people: a chat never gains people.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";

export interface Dropped { type: "file" | "folder"; id: string }

/** The things a Files drag carries, or none when the text is not a Files drag. */
export function droppedOf(text: string): Dropped[] {
  const out: Dropped[] = [];
  for (const part of text.split(",")) {
    const m = /^(file|folder):(\S+)$/.exec(part.trim());
    if (m) out.push({ type: m[1] as "file" | "folder", id: m[2] as string });
  }
  return out;
}

export interface Shared { grants: string[]; names: string[]; agents: string[] }

const nameOfThing = async (data: Pick<ConversationData, "call">, d: Dropped): Promise<string> => {
  try {
    return d.type === "file"
      ? ((await data.call("files.get", { fileId: d.id })) as CapMap["files.get"]["out"]).file.name
      : ((await data.call("files.folder.get", { folderId: d.id })) as CapMap["files.folder.get"]["out"]).folder.name;
  } catch { return d.type === "file" ? "a file" : "a folder"; }
};

/** Share each dropped thing with each agent of the chat. Resolves with the grants made (for Undo) and the names for the line. A share that is refused throws, so the person is told and nothing is half said. */
export async function shareWithAgents(data: Pick<ConversationData, "call">, items: readonly Dropped[], agents: readonly { id: string; name: string }[], key: string): Promise<Shared> {
  const names = await Promise.all(items.map((d) => nameOfThing(data, d)));
  const grants: string[] = [];
  for (const it of items) {
    for (const a of agents) {
      const out = (await data.call("access.share", { resource: { type: it.type, id: it.id }, subject: { kind: "agent", id: a.id }, level: "view", idempotencyKey: `drop-share:${key}:${it.id}:${a.id}` })) as CapMap["access.share"]["out"];
      grants.push(out.grant.id);
    }
  }
  return { grants, names, agents: agents.map((a) => a.name) };
}

/** Take the shares back: one unshare per grant made by the drop. */
export async function undoShare(data: Pick<ConversationData, "call">, grants: readonly string[]): Promise<void> {
  for (const grantId of grants) await data.call("access.unshare", { grantId });
}

const list = (xs: readonly string[]): string => (xs.length <= 2 ? xs.join(" and ") : `${xs[0]}, ${xs[1]} and ${xs.length - 2} more`);

/** "Shared Q4 pricing.docx with Intake. It can read it." */
export function sharedLine(s: Pick<Shared, "names" | "agents">): string {
  return `Shared ${list(s.names)} with ${list(s.agents)}.`;
}
