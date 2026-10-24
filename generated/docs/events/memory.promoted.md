# memory.promoted

A fact was promoted to a shared layer with the name and time of the person

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | entity at /newFactId |
| Visibility | space |
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
  newFactId: string;
  toLayer: string;
  by: string;
};
```
