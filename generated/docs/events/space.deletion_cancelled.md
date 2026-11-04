# space.deletion_cancelled

An admin cancelled the scheduled deletion; the Space carries on (every admin gets an Inbox line and an email)

| | |
|---|---|
| Module | spaces |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | space.deletion_cancelled |
| Retention | audit |

## Payload

```ts
type Payload = {
  by: string;
};
```
