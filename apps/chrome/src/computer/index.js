// @ts-check
// Vyre for Chrome inside an agent's computer (V1-SPEC 3.12, ARCH 7.12): the identity the extension runs as there (identity.js) and the recipes it writes from a person's recording
// (recipes.js). The worker, popup and agent tools are the same build as in a person's Chrome; this folder is what differs.

import { createAgentSession } from "./identity.js";
import { recipeNote, saveRecipe } from "./recipes.js";

export { AGENT_CAPABILITIES, AgentRefusal, createAgentSession, itemsOfAgent } from "./identity.js";
export { callNotes, callTemplate, paramsOf, recipeName, recipeNote, saveRecipe } from "./recipes.js";

/**
 * @param {Parameters<typeof createAgentSession>[0] & { now?: () => number }} o
 */
export function createComputerExtension(o) {
  const session = createAgentSession(o);
  return {
    session,
    /** The agent's items that fit a page address (names and field keys). @param {string} origin */
    itemsFor: (origin) => session.invoke("vault.items.match", { url: origin }),
    /** Turn a recording into recipes/<site>.md in the agent's memory. @param {import("./recipes.js").Recording} recording */
    async learnRecipe(recording) {
      const note = recipeNote(recording, o.now ? { now: o.now } : {});
      const saved = await saveRecipe(session, note, { recordingId: recording.id });
      return { ...saved, calls: note.calls, steps: note.steps };
    },
  };
}
