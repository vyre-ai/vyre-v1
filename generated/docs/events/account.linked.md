# account.linked

One account everywhere: this Space's sign-in took the username, password and key wraps of the account the person kept; their data and membership here did not change

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
  from: string;
  to: string;
};
```
