# skills.history

The versions of a skill, newest first, each with who saved it and what changed

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/skills/history |
| MCP tool | skill_history (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  skillId: string;
};
```

## Output

```ts
type Out = {
  revisions: Array<{
      rev: number;
      by: string;
      authorKind: "person" | "agent";
      summary: string;
      version?: string;
      undoOf?: number;
      at: number;
    }>;
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
    "skillId": "sko_a1b2c3"
  },
  "output": {
    "revisions": [
      {
        "at": 1760000000000,
        "authorKind": "person",
        "by": "example",
        "rev": 1,
        "summary": "example",
        "undoOf": 1,
        "version": "example"
      }
    ]
  }
}
```
