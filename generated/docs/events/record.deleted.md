# record.deleted

A record moved to Trash; prev carries the values it held (sealed and Restricted values as ciphertext only)

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A record is deleted |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  type: string;
  prev: Record<string, unknown>;
};
```
