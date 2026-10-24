# agent.model_changed

The model, provider, effort or account of an agent in a thread changed

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  threadId: string;
  agentId: string;
  model: string;
  provider: string;
  by: string;
};
```
