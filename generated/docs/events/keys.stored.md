# keys.stored

A wrapped key bundle was stored or re-wrapped

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
| Retention | default |

## Payload

```ts
type Payload = {
  personId: string;
  reason: "first_device" | "password_change" | "reset" | "recovery" | "space_key_epoch" | "new_device";
};
```
