# home.dismiss_checklist

Dismiss the first-run checklist

| | |
|---|---|
| Module | home |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/home/dismiss_checklist |
| MCP tool | home_dismiss_checklist (meta) |
| CLI | none |
| Emits | checklist.dismissed |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "ok": true
  }
}
```
