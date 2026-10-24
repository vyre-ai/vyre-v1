# session.revoked

A session was ended by the person or an admin

| | |
|---|---|
| Module | devices |
| Schema version | 1 |
| Subject | entity at /sessionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  sessionId: string;
  person: string;
  by: string;
};
```
