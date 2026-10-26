# records.trash_purged

Records past their Trash retention were hard-deleted (a count)

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | entity at /removed |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  removed: number;
};
```
