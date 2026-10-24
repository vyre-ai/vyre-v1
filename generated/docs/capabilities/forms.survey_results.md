# forms.survey_results

Aggregate results of a survey

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
| HTTP | POST /v1/forms/survey_results |
| MCP tool | forms_survey_results (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
};
```

## Output

```ts
type Out = {
  responses: number;
  questions: Array<{
      field: string;
      summary: unknown;
    }>;
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
    "formId": "frm_a1b2c3"
  },
  "output": {
    "questions": [
      {
        "field": "example",
        "summary": {}
      }
    ],
    "responses": 1
  }
}
```
