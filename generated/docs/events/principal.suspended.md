# principal.suspended

A principal was suspended

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /principalId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  principalId: string;
  reason?: string;
};
```
