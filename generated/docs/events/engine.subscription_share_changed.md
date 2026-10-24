# engine.subscription_share_changed

A person changed whether the Space may run work on their subscription

| | |
|---|---|
| Module | engine |
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
  enabled: boolean;
};
```
