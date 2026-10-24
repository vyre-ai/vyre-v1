# mcp.scopes_changed

The scopes of an outside actor changed

| | |
|---|---|
| Module | mcp |
| Schema version | 1 |
| Subject | entity at /actorId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  actorId: string;
  by: string;
};
```
