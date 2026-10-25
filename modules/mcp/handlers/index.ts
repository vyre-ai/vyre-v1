// Handler table of the mcp module: all 13 capabilities of manifests/mcp.ts.
import { health, scopesSet, sessionClose, sessionMint, sessionOpen, sessionsList, tokenIssue, tokenLogReveal, tokenRegister, toolDescribe, toolSearch, toolsList, toolsetsList } from "./server.ts";

export const handlers = {
  "mcp.token.issue": tokenIssue,
  "mcp.token.register": tokenRegister,
  "mcp.token.log_reveal": tokenLogReveal,
  "mcp.scopes.set": scopesSet,
  "mcp.session.open": sessionOpen,
  "mcp.session.mint": sessionMint,
  "mcp.session.close": sessionClose,
  "mcp.sessions.list": sessionsList,
  "mcp.tools.list": toolsList,
  "mcp.tool.search": toolSearch,
  "mcp.tool.describe": toolDescribe,
  "mcp.toolsets.list": toolsetsList,
  "mcp.health": health,
};

export { isLive, revokeActor } from "./server.ts";
