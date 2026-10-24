# memory.facts_as_of

Facts that were true on a date (valid_from and valid_to), for "what did it believe on 3 March"

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/facts_as_of |
| MCP tool | facts_as_of (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  date: number;
  agentId?: string;
  layer?: "person" | "agent" | "project" | "space";
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  facts: Array<{
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
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "cursor": "example",
    "date": 1760000000000,
    "layer": "person",
    "limit": 1,
    "q": "example"
  },
  "output": {
    "facts": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
