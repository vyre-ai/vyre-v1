# member.removed

A person was removed or left; devices purge, the Space key epoch rotates

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A person is removed |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  personId: string;
  by: string;
  reason?: string;
};
```
