# memory.promotion_requested

A promotion to a shared layer was requested

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
  toLayer: string;
  taskId?: string;
  by: string;
};
```
