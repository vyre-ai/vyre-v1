# hold.placed

A hold now blocks expiry and erasing

| | |
|---|---|
| Module | governance |
| Schema version | 1 |
| Subject | entity at /target/id |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  target: {
    kind: "file" | "channel" | "thread" | "folder" | "person";
    id: string;
  };
  reason: string;
  by: string;
};
```
