# block.waiting

A question or plan block is waiting for an answer and the turn is parked

| | |
|---|---|
| Module | chat |
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
  blockId: string;
  blockType: "question" | "plan";
};
```
