# github.runners.remove

Take back a runner that never ran a job (its machine failed to start)

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/runners/remove |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  runnerId: number;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "repo": "vyre-ai/website",
    "runnerId": 1
  },
  "output": {
    "removed": true
  }
}
```
