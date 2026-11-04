// An id from a tool result ([[Name|id]] in a reply) is opened by asking the capability that reads it: a mail thread or a calendar event. Nothing else is guessed.
import type { ConversationData } from "./model.ts";

const externalCache = new WeakMap<object, Map<string, Promise<{ kind: string; title: string } | null>>>();
/** What an id from a tool result opens: a mail thread (Inbox) or a calendar event, found by asking the capability that reads it. Null when neither knows it, or the reader may not see it. */
export function resolveExternal(data: Pick<ConversationData, "call">, id: string): Promise<{ kind: string; title: string } | null> {
  let m = externalCache.get(data.call);
  if (!m) { m = new Map(); externalCache.set(data.call, m); }
  let p = m.get(id);
  if (!p) {
    const ask = async (cap: string, input: unknown): Promise<Record<string, unknown> | null> => { try { return ((await data.call(cap, input)) ?? null) as Record<string, unknown> | null; } catch { return null; } };
    p = (async () => {
      if (id.startsWith("cev_")) { const e = await ask("calendar.get_event", { eventId: id }); const ev = (e?.["event"] ?? e) as { title?: unknown } | null; return ev ? { kind: "event", title: typeof ev.title === "string" ? ev.title : "Event" } : null; }
      const th = await ask("mail.thread.get", { threadId: id });
      if (th && typeof th["threadId"] === "string") return { kind: "mail", title: typeof th["subject"] === "string" ? th["subject"] : "Email" };
      const g = await ask("google.calendar.get_event", { eventId: id });
      const ev = (g?.["event"] ?? g) as { summary?: unknown; title?: unknown } | null;
      return ev && (ev.summary !== undefined || ev.title !== undefined) ? { kind: "event", title: String(ev.summary ?? ev.title) } : null;
    })();
    m.set(id, p);
  }
  return p;
}
