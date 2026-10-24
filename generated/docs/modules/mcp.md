# MCP (mcp)

Lane L2. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (13)

- [mcp.health](../capabilities/mcp.health.md): Health of the MCP endpoint: reachable, session count, registry hash served
- [mcp.scopes.set](../capabilities/mcp.scopes.set.md): Change the scopes of an outside actor (read, post in threads, read changesets, write on a branch with approval)
- [mcp.session.close](../capabilities/mcp.session.close.md): Close an MCP session
- [mcp.session.mint](../capabilities/mcp.session.mint.md): Mint the loopback session for a CLI engine: a session token that encodes principal, acting-for person, thread, run and trace
- [mcp.session.open](../capabilities/mcp.session.open.md): Open an MCP session from a registered token: resolves the actor, scopes and the toolsets it may list
- [mcp.sessions.list](../capabilities/mcp.sessions.list.md): Active and recent MCP sessions for the Console (outside actors and CLI engines)
- [mcp.token.issue](../capabilities/mcp.token.issue.md): Issue a one-time registration token for an outside agent: works once, within 10 minutes; reveal and copy are logged
- [mcp.token.log_reveal](../capabilities/mcp.token.log_reveal.md): Log that a one-time token was revealed or copied in the connect sheet
- [mcp.token.register](../capabilities/mcp.token.register.md): Exchange a one-time token for a registered outside-actor token (called by the outside tool, not by a signed-in person)
- [mcp.tool.describe](../capabilities/mcp.tool.describe.md): Full schema and examples of named tools
- [mcp.tool.search](../capabilities/mcp.tool.search.md): Find tools by what you want to do; returns names, summaries and schemas, then the tools are callable
- [mcp.tools.list](../capabilities/mcp.tools.list.md): Tools listed for this caller: about 60 by default; the rest are deferred and found with tool_search
- [mcp.toolsets.list](../capabilities/mcp.toolsets.list.md): Toolsets the caller may use (engineer needs engineer.mcp)

## Events (6)

- [mcp.scopes_changed](../events/mcp.scopes_changed.md): The scopes of an outside actor changed
- [mcp.session_ended](../events/mcp.session_ended.md): An MCP session ended
- [mcp.session_started](../events/mcp.session_started.md): An MCP session started
- [token.issued](../events/token.issued.md): A one-time registration token was issued for an outside agent (never the token itself)
- [token.registered](../events/token.registered.md): An outside agent registered with a one-time token and became an outside actor
- [token.revealed](../events/token.revealed.md): A one-time token was revealed or copied
