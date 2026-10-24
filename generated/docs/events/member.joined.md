# member.joined

A person accepted an invite and is active; the inviter gets a quiet line

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A person joins |
| Notification | member.joined |
| Retention | audit |

## Payload

```ts
type Payload = {
  personId: string;
  inviteId: string;
  role: string;
  invitedBy: string;
};
```
