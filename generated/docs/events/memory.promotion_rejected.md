# memory.promotion_rejected

A promotion was rejected

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | entity at /factId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  promotionId: string;
  factId: string;
  by: string;
};
```
