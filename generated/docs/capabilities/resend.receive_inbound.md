# resend.receive_inbound

Record a verified inbound route delivery after dedupe and land it with mail.ingest

| | |
|---|---|
| Module | resend |
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
| Team Space only | no |
| HTTP | POST /v1/resend/receive_inbound |
| MCP tool | none |
| CLI | none |
| Emits | resend.inbound_received |

## Input

```ts
type In = {
  emailId: string;
  route?: string;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
  messageId?: string;
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
    "emailId": "example",
    "route": "example"
  },
  "output": {
    "accepted": true,
    "messageId": "eml_a1b2c3"
  }
}
```
