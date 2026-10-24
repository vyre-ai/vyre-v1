# forms.submissions

List submissions of a form

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/submissions |
| MCP tool | forms_submissions (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      recordId: string;
      at: number;
      matched: boolean;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "formId": "frm_a1b2c3",
    "limit": 1
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "at": 1760000000000,
        "matched": true,
        "recordId": "rec_a1b2c3"
      }
    ],
    "total": 1
  }
}
```
