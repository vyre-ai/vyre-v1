# sync.scope_changed

A grant or label change affected many rows; clients refetch the entity range

| | |
|---|---|
| Module | sync |
| Schema version | 1 |
| Subject | entity at /entity |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  entity: string;
  personId?: string;
  filter?: unknown;
  rows: number;
};
```
