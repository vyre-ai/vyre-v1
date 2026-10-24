# mail.health

Mail sync health: age of the last successful sync per mailbox (worst state wins)

| | |
|---|---|
| Module | mail |
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
| HTTP | POST /v1/mail/health |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  mailboxId?: string;
};
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
  detail?: string;
  latencyMs?: number;
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
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "detail": "example",
    "latencyMs": 1,
    "state": "healthy"
  }
}
```
