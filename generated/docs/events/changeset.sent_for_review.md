# changeset.sent_for_review

A changeset was opened to an outside agent for review

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | entity at /changesetId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  changesetId: string;
  actorId?: string;
};
```
