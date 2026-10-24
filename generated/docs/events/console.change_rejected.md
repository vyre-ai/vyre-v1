# console.change_rejected

A person rejected a proposed change

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
  by: string;
};
```
