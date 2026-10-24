# forms.submit

Public submit: writes through as principal svc_form_<id> with source link holder; consent, captcha and rate limits apply; attribution captured

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record (create under /slug) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /f/submit |
| MCP tool | none |
| CLI | none |
| Emits | form.submitted |

## Input

```ts
type In = {
  slug: string;
  answers: Record<string, unknown>;
  attribution?: {
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
  token?: string;
  code?: string;
  captcha?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  recordId: string;
  thankYou?: string;
};
```

## Errors

- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- rate_limit.exceeded
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "answers": {},
    "attribution": {
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
    "captcha": "example",
    "code": "example",
    "idempotencyKey": "idem_1",
    "slug": "intake",
    "token": "example"
  },
  "output": {
    "recordId": "rec_a1b2c3",
    "thankYou": "example"
  }
}
```
