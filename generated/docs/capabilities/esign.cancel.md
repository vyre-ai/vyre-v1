# esign.cancel

Cancel an envelope

| | |
|---|---|
| Module | esign |
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
| Team Space only | yes |
| HTTP | POST /v1/esign/cancel |
| MCP tool | esign_cancel (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  envelopeId: string;
};
```

## Output

```ts
type Out = {
  cancelled: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "envelopeId": "env_a1b2c3"
  },
  "output": {
    "cancelled": true
  }
}
```
