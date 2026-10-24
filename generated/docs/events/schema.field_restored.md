# schema.field_restored

A dropped field came back from Trash

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
| Retention | default |

## Payload

```ts
type Payload = {
  type: string;
  field: string;
};
```
