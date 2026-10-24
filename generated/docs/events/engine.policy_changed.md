# engine.policy_changed

AI policies changed

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  keys: Array<string>;
  by: string;
};
```
