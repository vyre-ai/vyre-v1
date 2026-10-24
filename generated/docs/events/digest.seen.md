# digest.seen

A person saw their digest; it resets

| | |
|---|---|
| Module | home |
| Schema version | 1 |
| Subject | entity at /digestId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  digestId: string;
  person: string;
};
```
