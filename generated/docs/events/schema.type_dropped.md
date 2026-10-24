# schema.type_dropped

A record type was dropped (copy kept in Trash for 30 days)

| | |
|---|---|
| Module | schema |
| Schema version | 1 |
| Subject | record_type at /type |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | trash |

## Payload

```ts
type Payload = {
  type: string;
  changeId: string;
};
```
