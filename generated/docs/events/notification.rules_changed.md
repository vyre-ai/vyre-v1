# notification.rules_changed

Notification settings changed (hours, backstop, mutes)

| | |
|---|---|
| Module | notifications |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  fields: Array<string>;
};
```
