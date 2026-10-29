# turn.undone

A person undid what an agent turn changed

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  threadId: string;
  turnId: string;
  undone: number;
  by: string;
};
```
