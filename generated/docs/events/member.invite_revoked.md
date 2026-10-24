# member.invite_revoked

An invite was revoked

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /inviteId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  inviteId: string;
};
```
