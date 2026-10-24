# access.changed

Roles, groups, labels or membership changed; bumps the authorize cache epoch

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /epoch |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  epoch: number;
  what: "role" | "group" | "membership" | "label" | "actor" | "assignment";
  by: string;
};
```
