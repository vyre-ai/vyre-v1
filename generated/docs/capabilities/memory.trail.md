# memory.trail

The trail of changes to facts and pages (who, what, when, why and source), for what the reader can see; rows are never deleted and never hold content

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
| HTTP | POST /v1/memory/trail |
| MCP tool | memory_trail (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  factId?: string;
  pageId?: string;
  action?: string;
  actor?: string;
  since?: number;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      id: string;
      at: number;
      action: "create" | "edit" | "merge" | "delete" | "restore" | "archive" | "erase" | "learn" | "undo" | "accept" | "reject" | "promote" | "flag" | "resolve";
      actor: string;
      actorKind: "person" | "agent" | "upkeep" | "system";
      actingFor?: string;
      factId?: string;
      pageId?: string;
      layer?: "person" | "agent" | "project" | "space";
      source?: string;
      reason?: string;
      runId?: string;
      detail?: Record<string, unknown>;
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
    "action": "example",
    "actor": "example",
    "cursor": "example",
    "factId": "fct_a1b2c3",
    "limit": 1,
    "pageId": "example",
    "since": 1760000000000
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "actingFor": "example",
        "action": "create",
        "actor": "example",
        "actorKind": "person",
        "at": 1760000000000,
        "detail": {},
        "factId": "fct_a1b2c3",
        "id": "example",
        "layer": "person",
        "pageId": "example",
        "reason": "example",
        "runId": "example",
        "source": "example"
      }
    ],
    "total": 1
  }
}
```
