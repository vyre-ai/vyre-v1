# forms.attribution_get

First source and Latest source of a record

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/attribution_get |
| MCP tool | forms_attribution_get (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordId: string;
};
```

## Output

```ts
type Out = {
  first?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    clickIds?: Record<string, string>;
    referrer?: string;
    landingPage?: string;
    device?: string;
    location?: string;
    consent: boolean;
  };
  latest?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    clickIds?: Record<string, string>;
    referrer?: string;
    landingPage?: string;
    device?: string;
    location?: string;
    consent: boolean;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "first": {
      "clickIds": {},
      "consent": true,
      "device": "example",
      "landingPage": "example",
      "location": "example",
      "referrer": "example",
      "utmCampaign": "example",
      "utmMedium": "example",
      "utmSource": "example"
    },
    "latest": {
      "clickIds": {},
      "consent": true,
      "device": "example",
      "landingPage": "example",
      "location": "example",
      "referrer": "example",
      "utmCampaign": "example",
      "utmMedium": "example",
      "utmSource": "example"
    }
  }
}
```
