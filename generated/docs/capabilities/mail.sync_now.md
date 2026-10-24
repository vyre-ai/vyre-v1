# mail.sync_now

Sync a mailbox now

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | mailbox (/mailboxId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/sync_now |
| MCP tool | mail_sync_now (inbox) |
| CLI | none |
| Emits | mailbox.sync_completed, mailbox.sync_failed |

## Input

```ts
type In = {
  mailboxId: string;
};
```

## Output

```ts
type Out = {
  runId: string;
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
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
