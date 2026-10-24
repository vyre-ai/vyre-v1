# scheduler.waits.expire

Expire waits past their timeout and wake their owners with a timeout result

| | |
|---|---|
| Module | scheduler-api |
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
| HTTP | POST /v1/scheduler/waits/expire |
| MCP tool | none |
| CLI | none |
| Emits | wait.expired |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  expired: number;
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
  "input": {},
  "output": {
    "expired": 1
  }
}
```
