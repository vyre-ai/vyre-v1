# console.change_proposed

The Console assistant proposed a change as a diff card

| | |
|---|---|
| Module | console-assistant |
| Schema version | 1 |
| Subject | entity at /diffId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  diffId: string;
  kind: string;
  threadId: string;
};
```
