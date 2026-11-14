# state.changed

One person's state on one thing changed (read, done, star, follow, mute or pin): the event carries the new state of that thing and the badge it counts in, so a screen patches its row without asking again

| | |
|---|---|
| Module | state |
| Schema version | 1 |
| Subject | entity at /thing/id |
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
  thing: {
    type: string;
    id: string;
  };
  changed: Array<"read" | "done" | "star" | "follow" | "mute" | "pin">;
  now: number;
  by: string;
  state: {
    thing: {
      type: string;
      id: string;
    };
    readUpto: number;
    unread: number;
    done: number | null;
    starred: number | null;
    follow: ("following" | "left") | null;
    alert: boolean;
    muted: number | null;
    pin: number | null;
  };
  count: {
    scope: string;
    things: number;
    entries: number;
  };
};
```
