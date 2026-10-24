# spend.caps_changed

Spend caps changed

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /scope |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  scope: string;
  scopeId?: string;
  by: string;
};
```
