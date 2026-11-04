# hook.changed

A hook was added, changed, removed, paused or turned back on, or an admin switched agent-made hooks

| | |
|---|---|
| Module | hooks |
| Schema version | 1 |
| Subject | entity at /hookId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  hookId: string;
  scope: string;
  change: "added" | "changed" | "removed" | "paused" | "resumed" | "allowed_once" | "allowed_always" | "allow_removed" | "denied" | "agents_on" | "agents_off";
  by: string;
  line: string;
  threadId?: string;
  agentId?: string;
};
```
