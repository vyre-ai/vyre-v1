# field.revealed

A sealed field was revealed to one actor (audited)

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  type: string;
  field: string;
};
```
