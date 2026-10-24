# factor.enrolled

A second factor was added

| | |
|---|---|
| Module | identity |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  personId: string;
  kind: "totp" | "passkey";
};
```
