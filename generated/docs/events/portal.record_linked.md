# portal.record_linked

An outside account was linked to a record with a row rule

| | |
|---|---|
| Module | portal |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  accountId: string;
  recordId: string;
};
```
