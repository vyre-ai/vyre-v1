# memory.map_rewritten

MAP.md of an agent was rewritten by the nightly job

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  agentId: string;
  lines: number;
};
```
