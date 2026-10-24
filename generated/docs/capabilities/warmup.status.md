# warmup.status

Warmup state and health per mailbox: bounce, spam placement, reply

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | comms.domains |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/warmup/status |
| MCP tool | warmup_status (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  mailboxes: Array<{
      mailboxId: string;
      stage: "new" | "warming" | "ready" | "slowed";
      dailyCap: number;
      bounceRate: number;
      replyRate: number;
    }>;
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
    "mailboxes": [
      {
        "bounceRate": 1,
        "dailyCap": 1,
        "mailboxId": "mbx_a1b2c3",
        "replyRate": 1,
        "stage": "new"
      }
    ]
  }
}
```
