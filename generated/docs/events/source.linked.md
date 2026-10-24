# source.linked

The linking step attached a delivery to an existing record (sure match or person-confirmed)

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  sourceId: string;
  deliveryId: string;
  recordId: string;
  by: "rule" | "person";
};
```
