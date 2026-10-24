# audit.checkpointed

A signed checkpoint of the event hash chain was written

| | |
|---|---|
| Module | audit |
| Schema version | 1 |
| Subject | entity at /seq |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  seq: number;
  hash: string;
};
```
