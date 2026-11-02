# mcp.client_declined

A person said no to an app

| | |
|---|---|
| Module | mcp |
| Schema version | 1 |
| Subject | entity at /requestId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  requestId: string;
  person: string;
  clientName: string;
};
```
