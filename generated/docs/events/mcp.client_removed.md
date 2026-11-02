# mcp.client_removed

A person removed an outside agent; its sign-in ended

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
  by: string;
};
```
