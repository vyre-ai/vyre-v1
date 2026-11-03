# MCP (mcp)

Lane L2. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (17)

- [mcp.activity.list](../capabilities/mcp.activity.list.md): What an outside agent did: the tool, how it ended and where, never an input or an answer
- [mcp.connected.link](../capabilities/mcp.connected.link.md): The address to paste into an MCP app, and the one line for Claude Code
- [mcp.connected.list](../capabilities/mcp.connected.list.md): The outside agents you connected; with all, every outside agent in the Space (owners and admins, Console)
- [mcp.connected.remove](../capabilities/mcp.connected.remove.md): Remove an outside agent: its tokens end at once, a call in flight fails, and the agent goes to Trash
- [mcp.health](../capabilities/mcp.health.md): Health of the MCP endpoint: reachable, session count, registry hash served
- [mcp.oauth.allow](../capabilities/mcp.oauth.allow.md): A person allows an app to join: it becomes an agent they own, acting for them, and only the tab that asked can collect the sign-in
- [mcp.oauth.decline](../capabilities/mcp.oauth.decline.md): A person says no to an app that asked to join
- [mcp.oauth.replayed](../capabilities/mcp.oauth.replayed.md): System: a used code or refresh token came back, so that sign-in ended
- [mcp.oauth.request](../capabilities/mcp.oauth.request.md): An app that asked to join this Space: what it calls itself and where it goes, for the Allow sheet
- [mcp.session.close](../capabilities/mcp.session.close.md): Close an MCP session
- [mcp.session.mint](../capabilities/mcp.session.mint.md): Mint the loopback session for a CLI engine: a session token that encodes principal, acting-for person, thread, run and trace
- [mcp.sessions.list](../capabilities/mcp.sessions.list.md): Active and recent MCP sessions for the Console (outside actors and CLI engines)
- [mcp.setup.set](../capabilities/mcp.setup.set.md): Let an outside agent act for its person including setup, or take that back. Its person turns it on (they must hold the rights); its person or an owner or admin turns it off. Not a tool: no agent reaches it
- [mcp.tool.describe](../capabilities/mcp.tool.describe.md): Full schema and examples of named tools
- [mcp.tool.search](../capabilities/mcp.tool.search.md): Find tools by what you want to do; returns names, summaries and schemas, then the tools are callable
- [mcp.tools.list](../capabilities/mcp.tools.list.md): Tools listed for this caller: about 60 by default; the rest are deferred and found with tool_search
- [mcp.toolsets.list](../capabilities/mcp.toolsets.list.md): Toolsets the caller may use (engineer needs engineer.mcp)

## Events (7)

- [mcp.client_allowed](../events/mcp.client_allowed.md): A person allowed an app to join; it acts as the agent named (never a token)
- [mcp.client_declined](../events/mcp.client_declined.md): A person said no to an app
- [mcp.client_removed](../events/mcp.client_removed.md): A person removed an outside agent; its sign-in ended
- [mcp.client_replayed](../events/mcp.client_replayed.md): A used code or refresh token came back, so that sign-in ended
- [mcp.session_ended](../events/mcp.session_ended.md): An MCP session ended
- [mcp.session_started](../events/mcp.session_started.md): An MCP session started
- [mcp.setup_changed](../events/mcp.setup_changed.md): An outside agent may now act for its person including setup, or may not any more
