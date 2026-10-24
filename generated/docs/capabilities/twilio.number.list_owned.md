# twilio.number.list_owned

List numbers in the Twilio account

| | |
|---|---|
| Module | twilio |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | comms.numbers |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/twilio/number/list_owned |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  numbers: Array<{
      sid: string;
      e164: string;
      friendlyName?: string;
      capabilities: Array<string>;
      voiceUrl?: string;
      smsUrl?: string;
      statusUrl?: string;
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
    "numbers": [
      {
        "capabilities": [
          "example"
        ],
        "e164": "+14155550123",
        "friendlyName": "example",
        "sid": "example",
        "smsUrl": "example",
        "statusUrl": "example",
        "voiceUrl": "example"
      }
    ]
  }
}
```
