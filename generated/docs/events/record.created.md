# record.created

A record was created; fields carries the initial values (sealed and Restricted values as ciphertext only)

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A record is created |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  type: string;
  fields: Record<string, unknown>;
};
```
