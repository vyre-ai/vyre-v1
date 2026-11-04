# space.deletion_scheduled

The owner scheduled the Space for deletion; everything is removed on the date unless an admin cancels (every admin gets an Inbox line and an email)

| | |
|---|---|
| Module | spaces |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | space.deletion_scheduled |
| Retention | audit |

## Payload

```ts
type Payload = {
  by: string;
  at: number;
};
```
