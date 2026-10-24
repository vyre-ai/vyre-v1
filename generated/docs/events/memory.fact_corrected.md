# memory.fact_corrected

A fact was corrected: the old one closed, a new one added

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
  factId: string;
  closedFactId: string;
  by: string;
};
```
