// Handler table of the mcp module: all the capabilities of manifests/mcp.ts.
import { activityList, connectedLink, connectedList, connectedRemove, oauthAllow, oauthDecline, oauthReplayed, oauthRequest } from "./oauth.ts";
import { health, sessionClose, sessionMint, sessionsList, toolDescribe, toolSearch, toolsList, toolsetsList } from "./server.ts";

export const handlers = {
  "mcp.oauth.request": oauthRequest,
  "mcp.oauth.allow": oauthAllow,
  "mcp.oauth.decline": oauthDecline,
  "mcp.oauth.replayed": oauthReplayed,
  "mcp.connected.list": connectedList,
  "mcp.connected.link": connectedLink,
  "mcp.connected.remove": connectedRemove,
  "mcp.activity.list": activityList,
  "mcp.session.mint": sessionMint,
  "mcp.session.close": sessionClose,
  "mcp.sessions.list": sessionsList,
  "mcp.tools.list": toolsList,
  "mcp.tool.search": toolSearch,
  "mcp.tool.describe": toolDescribe,
  "mcp.toolsets.list": toolsetsList,
  "mcp.health": health,
};

export { isLive } from "./server.ts";
