# agent.suggestion_proposed

A change to an agent was suggested

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  suggestionId: string;
  agentId: string;
  kind: string;
  by: string;
};
```
