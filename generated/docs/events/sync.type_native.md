# sync.type_native

A synced type was detached and kept as a native type with its ids, history and attribution

| | |
|---|---|
| Module | connectors |
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
  syncTypeId: string;
  type: string;
};
```
