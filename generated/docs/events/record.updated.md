# record.updated

Fields of a record changed; fields carries the new values and prev the old ones (sealed and Restricted values as ciphertext only)

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A record changes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  type: string;
  fields: Record<string, unknown>;
  prev: Record<string, unknown>;
  version: number;
};
```
