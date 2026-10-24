# turn.block

A coalesced chunk of a running turn was persisted

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | transcripts |

## Payload

```ts
type Payload = {
  turnId: string;
  threadId: string;
  idx: number;
  kind: string;
};
```
