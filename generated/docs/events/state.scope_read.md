# state.scope_read

A person marked everything in one badge read: one event for the whole badge, with its new count

| | |
|---|---|
| Module | state |
| Schema version | 1 |
| Subject | entity at /scope |
| Visibility | private |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  scope: string;
  marked: number;
  count: {
    scope: string;
    things: number;
    entries: number;
  };
  now: number;
  by: string;
};
```
