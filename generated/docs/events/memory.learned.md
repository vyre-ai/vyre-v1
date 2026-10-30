# memory.learned

Memory learned a fact (ids and places only, never the text); the Learned feed reads this

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
  actor: string;
  actorKind: string;
  saved: boolean;
  from: string;
};
```
