# memory.learned

The Learned feed: what memory learned, newest first, with its source and who learned it, for what the reader can see; each row can be undone

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
| HTTP | POST /v1/memory/learned |
| MCP tool | memory_learned (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  layer?: "person" | "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
  since?: number;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
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
      at: number;
      actor: string;
      actorKind: "person" | "agent" | "upkeep" | "system";
      sourceKind: "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
      sourceRef: string;
      sourceLink?: string;
      from?: string;
      undone: boolean;
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
    "layer": "person",
    "limit": 1,
    "projectId": "prj_a1b2c3",
    "since": 1760000000000
  },
  "output": {
    "items": [
      {
        "actor": "example",
        "actorKind": "person",
        "at": 1760000000000,
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
        "from": "example",
        "sourceKind": "chat",
        "sourceLink": "example",
        "sourceRef": "example",
        "undone": true
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
