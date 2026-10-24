# signin.succeeded

A person signed in

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
  method: "password" | "github" | "sso" | "pair" | "recovery";
  deviceId: string;
};
```
