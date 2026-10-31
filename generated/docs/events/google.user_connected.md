# google.user_connected

A person signed in to their own Google account

| | |
|---|---|
| Module | google |
| Schema version | 1 |
| Subject | entity at /accountId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  accountId: string;
  email: string;
};
```
