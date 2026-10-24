# schema.changed

A record type or field changed (add, edit, retype, label, drop)

| | |
|---|---|
| Module | schema |
| Schema version | 1 |
| Subject | record_type at /type |
| Visibility | space |
| Label | internal |
| Replay | pure |
| Automation trigger | A record type or field changes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  changeId: string;
  type: string;
  types: Array<string>;
  ops: Array<{
      op: string;
      type: string;
      field?: string;
    }>;
  destructive: boolean;
};
```
