# contacts.suppression.check

Check addresses against the suppression list (the single send API calls this for every sender)

| | |
|---|---|
| Module | contacts-link |
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
| HTTP | POST /v1/contacts/suppression/check |
| MCP tool | contacts_suppression_check (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channel: "email" | "sms" | "call";
  addresses: Array<string>;
};
```

## Output

```ts
type Out = {
  suppressed: Array<{
      address: string;
      reason: "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | "import";
    }>;
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
    "addresses": [
      "example"
    ],
    "channel": "email"
  },
  "output": {
    "suppressed": [
      {
        "address": "example",
        "reason": "bounce_hard"
      }
    ]
  }
}
```
