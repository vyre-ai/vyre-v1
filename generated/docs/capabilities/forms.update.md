# forms.update

Change form name, match rule, consent text, captcha toggle, upload policy and rate limits

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | forms.publish |
| Grant level | edit |
| Risk | medium |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/update |
| MCP tool | forms_update (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  name?: string;
  matchRule?: Array<string>;
  consentText?: string;
  captcha?: boolean;
  uploadPolicy?: Record<string, unknown>;
  rateLimit?: number;
};
```

## Output

```ts
type Out = {
  form: {
    formId: string;
    name: string;
    recordType: string;
    kind: "public" | "one_use" | "booking" | "survey";
    state: "draft" | "published" | "closed";
    slug: string;
    submissions: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "captcha": true,
    "consentText": "example",
    "formId": "frm_a1b2c3",
    "matchRule": [
      "example"
    ],
    "name": "example",
    "rateLimit": 1,
    "uploadPolicy": {}
  },
  "output": {
    "form": {
      "formId": "frm_a1b2c3",
      "kind": "public",
      "name": "example",
      "recordType": "contact",
      "slug": "intake",
      "state": "draft",
      "submissions": 1
    }
  }
}
```
