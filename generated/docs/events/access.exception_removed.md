# access.exception_removed

A permission exception was removed by an admin, or lapsed at its end (lapsed)

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /exceptionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  exceptionId: string;
  subject: {
    kind: "person" | "group";
    id: string;
  };
  perms: Array<string>;
  effect: "allow" | "deny";
  lapsed: boolean;
  by: string;
};
```
