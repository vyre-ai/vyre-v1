# conversation.follow_changed

A person followed or unfollowed a contact conversation

| | |
|---|---|
| Module | inbox |
| Schema version | 1 |
| Subject | record at /contactId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  contactId: string;
  principalId: string;
  following: boolean;
  alertOnReplies: boolean;
};
```
