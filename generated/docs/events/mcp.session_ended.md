# mcp.session_ended

An MCP session ended

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
  calls?: number;
};
```
