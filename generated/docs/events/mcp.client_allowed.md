# mcp.client_allowed

A person allowed an app to join; it acts as the agent named (never a token)

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
  clientName: string;
  redirectHost?: string;
};
```
