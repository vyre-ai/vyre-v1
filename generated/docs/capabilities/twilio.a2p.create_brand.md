# twilio.a2p.create_brand

Register the Space brand for US texting

| | |
|---|---|
| Module | twilio |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.numbers |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/twilio/a2p/create_brand |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  legalName: string;
  ein?: string;
  website?: string;
  vertical?: string;
  address?: {
    line1: string;
    city: string;
    region: string;
    postal: string;
    country: string;
  };
  contactName?: string;
  contactEmail?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  brandSid: string;
  status: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "address": {
      "city": "example",
      "country": "example",
      "line1": "example",
      "postal": "example",
      "region": "example"
    },
    "contactEmail": "maya@example.com",
    "contactName": "example",
    "ein": "example",
    "idempotencyKey": "idem_1",
    "legalName": "example",
    "vertical": "example",
    "website": "example"
  },
  "output": {
    "brandSid": "example",
    "status": "example"
  }
}
```
