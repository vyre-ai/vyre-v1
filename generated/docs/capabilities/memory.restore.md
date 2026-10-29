# memory.restore

Restore a fact from Trash, or from Archive for an admin; open to any person or agent who can see the fact

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/restore |
| MCP tool | memory_restore (memory) |
| CLI | none |
| Emits | memory.restored |

## Input

```ts
type In = {
  factId: string;
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
    trashedAt?: number;
    trashReason?: string;
    archivedAt?: number;
  };
  restoredFrom: "trash" | "archive";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "factId": "fct_a1b2c3"
  },
  "output": {
    "fact": {
      "agentId": "agt_a1b2c3",
      "archivedAt": 1760000000000,
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
      "trashReason": "example",
      "trashedAt": 1760000000000,
      "validFrom": 1760000000000,
      "validTo": 1760000000000
    },
    "restoredFrom": "trash"
  }
}
```
