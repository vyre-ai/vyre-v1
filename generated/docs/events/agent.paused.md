# agent.paused

An agent was paused

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | An agent is paused |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  reason?: string;
  by: string;
};
```
