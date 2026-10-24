# member.invited

An invite was made

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
  role: string;
  expiresAt: number;
};
```
