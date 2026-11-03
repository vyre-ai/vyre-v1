# mcp.setup_changed

An outside agent may now act for its person including setup, or may not any more

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
  setup: boolean;
  by: string;
};
```
