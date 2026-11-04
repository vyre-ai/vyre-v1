// What the project page needs from the shell, built once for every place that draws it (Chats opens a project as its own tab; the record page of a project draws the same page).
import { listProjectImports } from "../../places/records/projectpage/data.tsx";
import type { ImportedSessionTranscript, ProjectPageData } from "../../places/records/projectpage/data.tsx";
import { nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

export function projectPageData(rt: ShellRuntime): ProjectPageData {
  // admin: the Console is the person's (the same permission that shows the Console on the rail); unknown permissions read as not an admin, so a member never sees an admin control
  const admin = rt.permissions?.has("console.access") === true;
  return { admin, spaceId: rt.space.id, call: rt.call, nameOf: nameLookup(rt), me: { id: rt.me.id, name: rt.me.name }, now: () => rt.clock().now, ...(rt.space.kind === "personal" ? { imports: {
    list: (projectId: string) => listProjectImports(rt.call, projectId),
    read: async (conversationId: string) => await rt.call("sessions.get", { conversationId }) as ImportedSessionTranscript,
    continue: async (conversationId: string) => {
      const out = await rt.call("sessions.continue", { conversationId, destinationSpaceId: rt.space.id, destinationScope: "personal", agentId: rt.assistant.id }) as { threadId: string };
      return out.threadId;
    },
  } } : {}), nav: {
    openChannel: (id) => rt.open({ subject: { type: "channel", id } }), openThread: (id) => rt.open({ subject: { type: "thread", id } }),
    openFolder: (id) => rt.open({ subject: { type: "folder", id } }), openFile: (id) => rt.open({ subject: { type: "file", id } }),
    openRecord: (type, id) => rt.open({ subject: { type: "record", id }, args: { type } }),
    openRecordPage: (type, id) => rt.open({ subject: { type: "record", id }, args: { type, recordView: "fields" } }),
    openGoal: (id) => rt.open({ subject: { type: "goal", id } }),
    openItem: (type, id) => rt.open({ subject: { type, id } }),
    openUrl: (url) => rt.openUrl(url),
    askAssistant: (text) => rt.open({ screen: "chats.ask", args: { with: "assistant", first: text } }),
  }, ...(rt.changes ? { changes: rt.changes } : {}) };
}
