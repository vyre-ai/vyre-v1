# access.everyone_defaults_changed

The default grants of the Everyone group changed

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  grants: number;
  by: string;
};
```
