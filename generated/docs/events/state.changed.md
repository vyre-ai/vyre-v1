# state.changed

One person's state on one thing changed: read, done, star, follow or mute

| | |
|---|---|
| Module | state |
| Schema version | 1 |
| Subject | entity at /thing/id |
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
  thing: {
    type: string;
    id: string;
  };
  changed: Array<"read" | "done" | "star" | "follow" | "mute">;
  now: number;
  by: string;
};
```
