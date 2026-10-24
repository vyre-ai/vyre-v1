# memory.fact_accepted

A proposed fact became current

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | entity at /factId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  factId: string;
  layer: "person" | "agent" | "project" | "space";
  auto: boolean;
};
```
