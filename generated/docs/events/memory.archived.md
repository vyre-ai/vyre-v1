# memory.archived

Facts untouched in Trash moved to Archive

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | entity at /count |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  count: number;
  days: number;
};
```
