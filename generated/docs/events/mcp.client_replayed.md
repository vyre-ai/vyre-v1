# mcp.client_replayed

A used code or refresh token came back, so that sign-in ended

| | |
|---|---|
| Module | mcp |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  agentId: string;
  person: string;
  why: string;
};
```
