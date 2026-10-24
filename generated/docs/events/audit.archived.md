# audit.archived

Audit rows older than the retention window moved to an encrypted archive file (never edited)

| | |
|---|---|
| Module | audit |
| Schema version | 1 |
| Subject | entity at /file |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  year: number;
  rows: number;
  file: string;
};
```
