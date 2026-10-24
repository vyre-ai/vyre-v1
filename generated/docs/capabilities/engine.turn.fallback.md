# engine.turn.fallback

Record a fallback during a turn error: another model or the backup key

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/fallback |
| MCP tool | none |
| CLI | none |
| Emits | turn.fallback_used |

## Input

```ts
type In = {
  turnId: string;
  kind: "switch_model" | "backup_key";
  to: string;
};
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
  "input": {
    "kind": "switch_model",
    "to": "example",
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
