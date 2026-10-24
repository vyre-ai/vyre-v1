# token.revoked

An outside actor token was revoked

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /actorId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  actorId: string;
  by: string;
};
```
