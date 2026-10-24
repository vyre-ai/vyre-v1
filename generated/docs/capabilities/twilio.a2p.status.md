# twilio.a2p.status

Status of the brand and campaign registration

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
| HTTP | POST /v1/twilio/a2p/status |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  brandSid?: string;
  campaignSid?: string;
};
```

## Output

```ts
type Out = {
  brand?: string;
  campaign?: string;
  rejectedReason?: string;
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
  "input": {
    "brandSid": "example",
    "campaignSid": "example"
  },
  "output": {
    "brand": "example",
    "campaign": "example",
    "rejectedReason": "example"
  }
}
```
