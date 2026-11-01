# comms.senders.set_default

Choose the default sender of a channel for me; it must be a usable sender from comms.senders.list

| | |
|---|---|
| Module | inbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/comms/senders/set_default |
| MCP tool | comms_senders_set_default (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channel: "email" | "text";
  senderId: string;
};
```

## Output

```ts
type Out = {
  channel: "email" | "text";
  senderId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "channel": "email",
    "senderId": "mbx_a1b2c3"
  },
  "output": {
    "channel": "email",
    "senderId": "example"
  }
}
```
