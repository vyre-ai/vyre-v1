# hold.released

A hold was released

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
  by: string;
};
```
