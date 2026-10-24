# memory.promotion.approve

Approve a promotion request (the approver action on its task)

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/memory/promotion/approve |
| MCP tool | memory_promotion_approve (memory) |
| CLI | none |
| Emits | memory.promoted |

## Input

```ts
type In = {
  promotionId: string;
};
```

## Output

```ts
type Out = {
  fact: {
    factId: string;
    layer: "person" | "agent" | "project" | "space";
    ownerRef: string;
    agentId?: string;
    noteId?: string;
    text: string;
    validFrom: number;
    validTo?: number;
    learnedAt: number;
    closedAt?: number;
    sourceKind: "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
    sourceRef: string;
    sourceLink?: string;
    status: "proposed" | "current" | "closed" | "removed";
    lowRisk?: boolean;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "promotionId": "prm_a1b2c3"
  },
  "output": {
    "fact": {
      "agentId": "agt_a1b2c3",
      "closedAt": 1760000000000,
      "factId": "fct_a1b2c3",
      "layer": "person",
      "learnedAt": 1760000000000,
      "lowRisk": true,
      "noteId": "not_a1b2c3",
      "ownerRef": "agt_a1b2c3",
      "sourceKind": "chat",
      "sourceLink": "example",
      "sourceRef": "example",
      "status": "proposed",
      "text": "example",
      "validFrom": 1760000000000,
      "validTo": 1760000000000
    }
  }
}
```
