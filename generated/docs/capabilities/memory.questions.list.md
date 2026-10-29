# memory.questions.list

Questions upkeep could not settle: two values for one subject and field, or a fact that looks old

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
| HTTP | POST /v1/memory/questions/list |
| MCP tool | memory_questions (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  status?: "open" | "resolved";
  kind?: "contradiction" | "stale";
  layer?: "person" | "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  questions: Array<{
      questionId: string;
      kind: "contradiction" | "stale";
      status: "open" | "resolved";
      createdAt: number;
      layer: "person" | "agent" | "project" | "space";
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
          trashedAt?: number;
          trashReason?: string;
          archivedAt?: number;
        }>;
      resolution?: string;
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
    "kind": "contradiction",
    "layer": "person",
    "limit": 1,
    "projectId": "prj_a1b2c3",
    "status": "open"
  },
  "output": {
    "next": "example",
    "questions": [
      {
        "createdAt": 1760000000000,
        "facts": [
          {
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
          }
        ],
        "kind": "contradiction",
        "layer": "person",
        "questionId": "example",
        "resolution": "example",
        "status": "open"
      }
    ],
    "total": 1
  }
}
```
