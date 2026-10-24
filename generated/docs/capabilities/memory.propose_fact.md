# memory.propose_fact

Propose a fact for the asker layer of the agent memory, with its source; low-risk kinds merge on their own

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/propose_fact |
| MCP tool | memory_propose (memory) |
| CLI | none |
| Emits | memory.fact_proposed, memory.fact_accepted |

## Input

```ts
type In = {
  layer?: "person" | "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
  text: string;
  validFrom?: number;
  sourceKind: "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
  sourceRef: string;
  threadId?: string;
  kind?: string;
  idempotencyKey: string;
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
  merged: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "preference",
    "layer": "person",
    "projectId": "prj_a1b2c3",
    "sourceKind": "chat",
    "sourceRef": "example",
    "text": "example",
    "threadId": "thr_a1b2c3",
    "validFrom": 1760000000000
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
    },
    "merged": true
  }
}
```
