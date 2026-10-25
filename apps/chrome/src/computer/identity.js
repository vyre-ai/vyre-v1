// @ts-check
// The extension inside an agent's computer (V1-SPEC 3.12 "In the agent's computer", ARCH 7.12): the same build, signed in as the agent with an agent token, tied to one Space.
// What changes against a person's Chrome:
//   * every call goes out as the agent (kind "agent", its id) for that one Space; the token rides on the link, never in an input, a store, a log line or a result;
//   * only the capabilities below can be called: fill from handles (vault.items.match, vault.use, vault.fill) and keep the agent's own recipe notes (files.*). A person's operations
//     (switching Space, the agent list, Ask, opening the app, saving a login, sharing) do not exist here;
//   * what comes back is cut to the agent's own items: items it owns, and items shared with it at Use level or above. The Space already answers an agent token this way; the cut here is a second lock.
// Values never come back: vault.use returns a handle and vault.fill asks the Space's filler on this computer to push the value to the page, so a value stays on this computer.

/** Capabilities the extension may call in an agent's computer, and what each is for. */
export const AGENT_CAPABILITIES = Object.freeze({
  "vault.items.match": "the agent's items that fit a page address: names and field keys, never values",
  "vault.use": "ask for one of the agent's items and get a handle",
  "vault.fill": "fill a handle field into a browser ref on this computer; the filler pushes the value to the page",
  "files.list": "list the agent's recipes folder",
  "files.create": "write a new recipe note",
  "files.write": "update a recipe note the agent already has",
});

const AGENT_ID = /^agt_[a-z0-9]+$/;
const SPACE_ID = /^[A-Za-z0-9_-]{3,80}$/;
const FOLDER_ID = /^[A-Za-z0-9_-]{3,80}$/;
const USE_LEVELS = new Set(["use", "edit", "manage"]);

export class AgentRefusal extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "AgentRefusal";
    this.code = code;
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Keep the items this agent may see: its own, and those shared with it at Use level or above. Returns the kept entries and how many were dropped.
 * An entry is what vault.items.match returns: { item, usernameField? }.
 * @param {string} agentId @param {unknown} entries
 * @returns {{ kept: any[], hidden: number }}
 */
export function itemsOfAgent(agentId, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const kept = list.filter((e) => {
    const item = isObject(e) && isObject(e["item"]) ? e["item"] : null;
    if (!item) return false;
    if (item["owner"] === agentId) return true;
    return item["scope"] === "shared" && USE_LEVELS.has(String(item["yourLevel"]));
  });
  return { kept, hidden: list.length - kept.length };
}

/**
 * The agent's session in its computer.
 * @param {{
 *   agentId: string, spaceId: string, token: string, recipesFolderId: string,
 *   link: { invoke(capability: string, input: Record<string, any>, auth: { token: string, as: { kind: "agent", id: string }, space: string }): Promise<any> },
 * }} o
 */
export function createAgentSession(o) {
  if (!AGENT_ID.test(o.agentId)) throw new AgentRefusal("bad_agent", "the agent id is not an agent id");
  if (!SPACE_ID.test(o.spaceId)) throw new AgentRefusal("bad_space", "the Space id is not valid");
  if (typeof o.token !== "string" || o.token.length < 16) throw new AgentRefusal("bad_token", "the agent token is missing or too short");
  if (!FOLDER_ID.test(o.recipesFolderId)) throw new AgentRefusal("bad_folder", "the recipes folder id is not valid");
  const { agentId, spaceId, recipesFolderId, link } = o;
  const token = o.token;
  const as = /** @type {const} */ ({ kind: "agent", id: agentId });

  return {
    agentId, spaceId, recipesFolderId,
    /** What this session is, for the popup-less status line and the logs. Never the token. */
    describe: () => ({ kind: "agent", agentId, spaceId }),
    toJSON: () => ({ kind: "agent", agentId, spaceId }),
    /**
     * One call as the agent, for its one Space. The caller's input may not name another Space or another actor.
     * @param {string} capability @param {Record<string, any>} [input]
     */
    async invoke(capability, input = {}) {
      if (!(capability in AGENT_CAPABILITIES)) throw new AgentRefusal("not_allowed", `the extension in an agent's computer may not call ${capability}`);
      for (const k of ["space", "spaceId", "as", "actor", "principal", "token"]) {
        if (k in input) throw new AgentRefusal("not_allowed", `${k} is set by the session, not by the caller`);
      }
      const out = await link.invoke(capability, input, { token, as, space: spaceId });
      if (capability === "vault.items.match") {
        const { kept, hidden } = itemsOfAgent(agentId, isObject(out) ? out["items"] : []);
        return { items: kept, hidden };
      }
      return out;
    },
  };
}
