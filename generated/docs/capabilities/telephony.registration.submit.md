# telephony.registration.submit

Submit the Space's brand and campaign registration to Twilio

| | |
|---|---|
| Module | telephony |
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
| HTTP | POST /v1/telephony/registration/submit |
| MCP tool | telephony_registration_submit (inbox) |
| CLI | none |
| Emits | registration.submitted |

## Input

```ts
type In = {
  registrationId: string;
  idempotencyKey: string;
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
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
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
