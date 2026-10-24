# grant.updated

The level, conditions or expiry of a grant changed

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /grantId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  grantId: string;
  level: "view" | "use" | "edit" | "manage";
  expiresAt?: number;
};
```
