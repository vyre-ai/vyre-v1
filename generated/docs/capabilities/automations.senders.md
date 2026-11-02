# automations.senders

What this Automation sends from: the mailboxes and numbers its steps name, and whether each can send now

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/senders |
| MCP tool | automations_senders (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
};
```

## Output

```ts
type Out = {
  senders: Array<{
      id: string;
      channel: "email" | "text";
      address: string;
      usable: boolean;
      why?: string;
    }>;
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
    "automationId": "aut_a1b2c3"
  },
  "output": {
    "senders": [
      {
        "address": "example",
        "channel": "email",
        "id": "example",
        "usable": true,
        "why": "example"
      }
    ]
  }
}
```
