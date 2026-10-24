# audit.verified

The chain and checkpoints were verified

| | |
|---|---|
| Module | audit |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  ok: boolean;
  checked: number;
  firstBadSeq?: number;
  by: string;
};
```
