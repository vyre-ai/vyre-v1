# dropbox.changes_received

Dropbox said files changed in these accounts

| | |
|---|---|
| Module | dropbox |
| Schema version | 1 |
| Subject | entity at /eventId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  eventId: string;
  accounts: Array<string>;
};
```
