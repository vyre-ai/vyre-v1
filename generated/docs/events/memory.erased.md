# memory.erased

Facts were erased from history (who and when only)

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  count: number;
  by: string;
  scope?: string;
};
```
