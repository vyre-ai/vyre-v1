# memory.fact_proposed

A fact was proposed (ids and layer only, never the text)

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
  ownerRef: string;
  agentId?: string;
  sourceKind: string;
  sourceRef: string;
};
```
