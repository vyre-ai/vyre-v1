# conflicts.get

Read one conflict with both values, the base, the proposal and the resolution

| | |
|---|---|
| Module | conflicts |
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
| HTTP | POST /v1/conflicts/get |
| MCP tool | conflicts_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conflictId: string;
};
```

## Output

```ts
type Out = {
  conflict: {
    conflictId: string;
    entity: string;
    recordId: string;
    field: string;
    ours: unknown;
    theirs: unknown;
    base: unknown;
    state: "open" | "proposed" | "needs_you" | "resolved" | "undone";
    plainChoice: boolean;
    protectedField: boolean;
    proposal?: {
      choice: "ours" | "theirs" | "merged" | "custom";
      value: unknown;
      summary: string;
    };
    resolution?: {
      resolutionId: string;
      choice: "ours" | "theirs" | "merged" | "custom";
      summary: string;
      by: string;
      at: number;
      canUndo: boolean;
      canRedo: boolean;
    };
    openedAt: number;
    taskId?: string;
    runId?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "conflictId": "cfl_a1b2c3"
  },
  "output": {
    "conflict": {
      "base": {},
      "conflictId": "cfl_a1b2c3",
      "entity": "rt_contact",
      "field": "example",
      "openedAt": 1760000000000,
      "ours": {},
      "plainChoice": true,
      "proposal": {
        "choice": "ours",
        "summary": "example",
        "value": {}
      },
      "protectedField": true,
      "recordId": "example",
      "resolution": {
        "at": 1760000000000,
        "by": "example",
        "canRedo": true,
        "canUndo": true,
        "choice": "ours",
        "resolutionId": "res_a1b2c3",
        "summary": "example"
      },
      "runId": "run_a1b2c3",
      "state": "open",
      "taskId": "tsk_a1b2c3",
      "theirs": {}
    }
  }
}
```
