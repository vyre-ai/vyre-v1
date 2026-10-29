// Keeps CLAUDE.md and AGENTS.md in an agent's folder in step with its MAP.md (memory design, "Native for any model"). The nightly job writes MAP.md and says so with memory.map_rewritten; this consumer
// renders the same map as the memory guide an engine reads (lib/memory-guide.ts) into both files. Agents own their folder and the server cannot see agents from another module, so the sync is here.
// A file with one of those names that Vyre did not write is somebody's own and is left alone.
import { GUIDE_FILES, isGuide, memoryGuide } from "../../lib/memory-guide.ts";
import { agentBy, call, codeOf, ensure, makeFile, meta, setMeta } from "./projections.ts";
import type { AgentsCtx } from "./projections.ts";

/** Write the guide files of one agent. Returns the names written (none when the map has not changed since). */
export async function syncMemoryGuide(ctx: AgentsCtx, input: { agentId: string }): Promise<string[]> {
  ensure(ctx.db);
  const a = agentBy(ctx.db, input.agentId);
  if (!a || a.folderId === undefined) return [];
  let map: string | undefined;
  try { map = ((await call<{ map?: { body?: string } }>(ctx, "memory.map.get", { agentId: a.id })).map?.body); } catch (e) {
    ctx.log.warn("agents: the memory map could not be read for the guide", { agent: a.id, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    return [];
  }
  if (map === undefined) return [];
  const body = memoryGuide(a.name, map);
  const written: string[] = [];
  for (const name of GUIDE_FILES) {
    const key = `memory_guide:${a.id}:${name}`;
    try {
      let id = meta(ctx.db, key);
      if (id) {
        try {
          const now = ((await call<{ text?: string }>(ctx, "files.read", { fileId: id, as: "text" })).text) ?? "";
          if (now === body) continue;
          if (now !== "" && !isGuide(now)) continue;
          await call(ctx, "files.write", { fileId: id, content: { text: body }, reason: "Memory guide from MAP.md" });
          written.push(name);
          continue;
        } catch (e) {
          if (codeOf(e) !== "validation.not_found") throw e;
          id = undefined;
        }
      }
      const made = await makeFile(ctx, a.folderId, name, body, `agents:${a.id}:memory_guide:${name}:${ctx.now()}`);
      setMeta(ctx.db, key, made.fileId);
      written.push(name);
    } catch (e) {
      // a file already there with that name is somebody's; anything else is worth a line
      if (codeOf(e) !== "validation.duplicate") ctx.log.warn("agents: the memory guide could not be written", { agent: a.id, file: name, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  }
  return written;
}

export const memoryGuideConsumers = {
  /** The nightly job rewrote an agent's MAP.md: its folder's CLAUDE.md and AGENTS.md follow. */
  "agents.memory_guide": {
    on: ["memory.map_rewritten"],
    run: (ctx: AgentsCtx, event: { payload: { agentId?: string } }): Promise<string[]> => (event.payload.agentId ? syncMemoryGuide(ctx, { agentId: event.payload.agentId }) : Promise.resolve([])),
  },
};
