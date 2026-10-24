# signin.failed

A sign-in attempt failed (counted for lockout; no password stored)

| | |
|---|---|
| Module | identity |
| Schema version | 1 |
| Subject | entity at /username |
| Visibility | private |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  username: string;
  reason: "bad_credentials" | "bad_code" | "locked" | "sso_denied";
};
```
