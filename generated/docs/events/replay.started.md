# replay.started

A replay sandbox started on a copy of the Space

| | |
|---|---|
| Module | logs |
| Schema version | 1 |
| Subject | entity at /replayId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  replayId: string;
  atSeq: number;
  runId?: string;
};
```
