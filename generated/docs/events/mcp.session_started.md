# mcp.session_started

An MCP session started

| | |
|---|---|
| Module | mcp |
| Schema version | 1 |
| Subject | entity at /sessionId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  sessionId: string;
  kind: string;
  principal: string;
  actingFor?: string;
  threadId?: string;
};
```
