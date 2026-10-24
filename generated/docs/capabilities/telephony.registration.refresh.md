# telephony.registration.refresh

Pull the latest registration status from Twilio

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.numbers |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/registration/refresh |
| MCP tool | telephony_registration_refresh (inbox) |
| CLI | none |
| Emits | registration.status_changed |

## Input

```ts
type In = {
  registrationId: string;
};
```

## Output

```ts
type Out = {
  registration: {
    id: string;
    legalName: string;
    ein?: string;
    website?: string;
    address?: {
      line1: string;
      city: string;
      region: string;
      postal: string;
      country: string;
    };
    contactName?: string;
    contactEmail?: string;
    useCase?: string;
    sampleMessages?: Array<string>;
    optInDescription?: string;
    state: "draft" | "submitted" | "in_review" | "approved" | "rejected";
    rejectedReason?: string;
    submittedAt?: number;
  };
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
    "registrationId": "reg_a1b2c3"
  },
  "output": {
    "registration": {
      "address": {
        "city": "example",
        "country": "example",
        "line1": "example",
        "postal": "example",
        "region": "example"
      },
      "contactEmail": "example",
      "contactName": "example",
      "ein": "example",
      "id": "reg_a1b2c3",
      "legalName": "example",
      "optInDescription": "example",
      "rejectedReason": "example",
      "sampleMessages": [
        "example"
      ],
      "state": "draft",
      "submittedAt": 1760000000000,
      "useCase": "example",
      "website": "example"
    }
  }
}
```
