# thread.erased

A chat thread was erased for good with its messages, blocks, pins and transcript (ids only)

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | entity at /threadId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  threadId: string;
};
```
