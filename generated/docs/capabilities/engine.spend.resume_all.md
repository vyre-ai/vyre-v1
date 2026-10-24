# engine.spend.resume_all

Resume AI spend after a pause

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | ai.spend |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/spend/resume_all |
| MCP tool | engine_spend_resume_all (meta) |
| CLI | none |
| Emits | spend.resumed |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  paused: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "paused": true
  }
}
```
