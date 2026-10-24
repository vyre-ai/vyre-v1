# agent.suggestion_resolved

A suggestion was accepted or dismissed

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
  accepted: boolean;
  by: string;
};
```
