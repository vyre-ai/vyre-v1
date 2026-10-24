# twilio.call.update

Change a live call: hang up, hold, resume or redirect to a teammate or agent

| | |
|---|---|
| Module | twilio |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/twilio/call/update |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  sid: string;
  action: "hangup" | "hold" | "resume" | "redirect";
  targetUrl?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  status: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "action": "hangup",
    "idempotencyKey": "idem_1",
    "sid": "example",
    "targetUrl": "example"
  },
  "output": {
    "status": "example"
  }
}
```
