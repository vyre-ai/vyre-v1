# twilio.call.get

Read a call from Twilio

| | |
|---|---|
| Module | twilio |
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
| HTTP | POST /v1/twilio/call/get |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  sid: string;
};
```

## Output

```ts
type Out = {
  status: string;
  durationSec?: number;
  from: string;
  to: string;
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
    "sid": "example"
  },
  "output": {
    "durationSec": 1,
    "from": "example",
    "status": "example",
    "to": "example"
  }
}
```
