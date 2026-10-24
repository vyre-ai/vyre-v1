# policy.changed

A Space policy was set or reset (Gate rule, spend, label rule, sign-in, sharing, retention, vault)

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /key |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  key: string;
  scope: string;
  kind: string;
  by: string;
};
```
