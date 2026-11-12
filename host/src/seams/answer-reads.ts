// What an agent read during a turn in a chat (agent-visibility gap 6). The invoke pipeline notes every read an agent makes for a person inside a chat: the resource it resolved to, the same one
// authorize checked. When the turn's answer is about to be posted where other people read, the engine module compares each of these against everyone in the chat (modules/engine/answer-audience.ts):
// an answer built on something one of them may not open goes to the asker privately.
// Kept in memory per chat, agent and asker; a turn's notes are taken (and cleared) when its answer is checked, and cleared when the next turn for the same three starts.

export interface ReadResource { type: string; id: string | null }
export interface ReadNote { thread: string; agent: string; asker: string; resource: ReadResource }

const MAX_KEYS = 2_000;
const MAX_PER_TURN = 200;
const notes = new Map<string, Map<string, ReadResource>>();
const keyOf = (thread: string, agent: string, asker: string): string => `${thread}\u0000${agent}\u0000${asker}`;

export function noteRead(n: ReadNote): void {
  const k = keyOf(n.thread, n.agent, n.asker);
  let m = notes.get(k);
  if (!m) {
    if (notes.size >= MAX_KEYS) notes.delete(notes.keys().next().value as string);
    m = new Map();
    notes.set(k, m);
  }
  if (m.size < MAX_PER_TURN) m.set(`${n.resource.type}:${n.resource.id ?? ""}`, { type: n.resource.type, id: n.resource.id });
  // past the cap the turn read too much to list: one marker makes the check treat it as unknown, which never shares
  else m.set("*:*", { type: "*", id: null });
}

/** Has this turn read anything yet? (The live text of such a turn streams to the asker only.) */
export const hasReads = (thread: string, agent: string, asker: string): boolean => (notes.get(keyOf(thread, agent, asker))?.size ?? 0) > 0;

/** The reads of the turn now ending, cleared as they are taken. */
export function takeReads(thread: string, agent: string, asker: string): ReadResource[] {
  const k = keyOf(thread, agent, asker);
  const m = notes.get(k);
  notes.delete(k);
  return m ? [...m.values()] : [];
}

export function clearReads(thread: string, agent: string, asker: string): void { notes.delete(keyOf(thread, agent, asker)); }

// A call the gateway noted as the agent's own Space browser that its handler sent to the agent's computer instead (the browser was not usable; review A2, 12 Nov): the handler puts the computer in
// the browser's place, so the answer check and the audit row name the place the call really went.
const fellBack = new Map<string, string>();

/** The handler sent a call noted as the agent's browser profile to its computer: note the computer instead, and remember it for this trace's audit row. */
export function retargetRead(n: { thread?: string | undefined; agent: string; asker?: string | undefined; traceId: string; computerId: string }): void {
  if (fellBack.size >= MAX_KEYS) fellBack.delete(fellBack.keys().next().value as string);
  fellBack.set(n.traceId, n.computerId);
  if (n.thread === undefined || n.asker === undefined) return;
  const m = notes.get(keyOf(n.thread, n.agent, n.asker));
  if (!m || !m.delete(`browser_profile:${n.agent}`)) return;
  m.set(`computer:${n.computerId}`, { type: "computer", id: n.computerId });
}

/** The computer a call of this trace fell back to, taken once (for its audit row). */
export function takeFallback(traceId: string): string | undefined {
  const c = fellBack.get(traceId);
  fellBack.delete(traceId);
  return c;
}
