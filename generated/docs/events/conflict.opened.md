# conflict.opened

Two edits to a protected or concurrent field collided and the op was parked for the assistant

| | |
|---|---|
| Module | sync |
| Schema version | 1 |
| Subject | entity at /conflictId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conflictId: string;
  entity: string;
  recordId: string;
  field: string;
  actor: string;
  plainChoice: boolean;
  traceId: string;
};
```
