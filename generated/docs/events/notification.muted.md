# notification.muted

A sender, channel or record was muted for a time

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
  target: {
    kind: "person" | "agent" | "channel" | "record" | "thread";
    id: string;
  };
  until: number;
};
```
