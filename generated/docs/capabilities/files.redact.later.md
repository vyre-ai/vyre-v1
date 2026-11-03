# files.redact.later

Not now: put an agent's request to read aside

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/redact/later |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
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
    "requestId": "rrq_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
