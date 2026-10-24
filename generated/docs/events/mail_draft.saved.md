# mail_draft.saved

A draft was created or changed (an agent draft carries a Gate line)

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | entity at /draftId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  draftId: string;
  mailboxId: string;
  byAgent?: string;
  contactId?: string;
};
```
