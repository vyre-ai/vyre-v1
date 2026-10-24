# engine.runtime_opt_in_changed

A person changed whether the Space may continue their chats when their computer is off

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
