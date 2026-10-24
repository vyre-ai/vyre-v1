# warmup.start

Start warming a new domain or mailbox

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.domains |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/warmup/start |
| MCP tool | warmup_start (inbox) |
| CLI | none |
| Emits | warmup.slowed |

## Input

```ts
type In = {
  mailboxId: string;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
