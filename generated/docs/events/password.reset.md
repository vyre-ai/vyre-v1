# password.reset

An admin reset a password and the person set a new one (Mine items lost unless a recovery code was saved)

| | |
|---|---|
| Module | identity |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  personId: string;
  by: string;
  recovered: boolean;
};
```
