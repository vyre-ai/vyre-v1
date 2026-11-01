# engine.crew.workspace

System: the repository copy a teammate thread works in, so the engine can make it before the first turn

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/workspace |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  workspace: {
    jobId: string;
    repo: string;
    base: string;
    branch: string;
    name: string;
  } | null;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "workspace": {
      "base": "example",
      "branch": "example",
      "jobId": "example",
      "name": "example",
      "repo": "example"
    }
  }
}
```
