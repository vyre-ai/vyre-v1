# microsoft.user_connected

A person signed in to their own Microsoft account

| | |
|---|---|
| Module | microsoft |
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
