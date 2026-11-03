# access.exception_set

A person or group was given a permission exception: Allowed or Not allowed on permissions, against their role

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
  effect: "allow" | "deny" | "own" | "ask";
  area?: string;
  until?: number;
  by: string;
};
```
