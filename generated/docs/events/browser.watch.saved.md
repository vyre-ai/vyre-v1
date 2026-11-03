# browser.watch.saved

A watch was made, changed, paused, resumed or removed

| | |
|---|---|
| Module | automations |
| Schema version | 1 |
| Subject | entity at /watchId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  watchId: string;
  owner: string;
  op: "added" | "changed" | "paused" | "resumed" | "removed";
};
```
