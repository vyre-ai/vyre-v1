# turn.completed

A turn finished

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | An agent turn finishes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  turnId: string;
  threadId: string;
  agentId: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
};
```
