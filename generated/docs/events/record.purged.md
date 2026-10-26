# record.purged

A record was hard-deleted for good (ids only)

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | entity at /recordId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  type: string;
  recordId: string;
};
```
