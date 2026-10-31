# thread.unarchived

A chat came back into a person's list: they unarchived it, or someone @mentioned them in it

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | entity at /threadId |
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
  threadId: string;
  reason: "person" | "mention";
};
```
