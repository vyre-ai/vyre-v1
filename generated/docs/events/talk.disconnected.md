# talk.disconnected

A Talk key was removed

| | |
|---|---|
| Module | talk |
| Schema version | 1 |
| Subject | entity at /provider |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  scope: "mine" | "space";
  provider: string;
  by: string;
};
```
