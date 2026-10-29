# forms.ask_diff

Ask Vyre edit of a form's source: an agent proposes changes to the HTML, CSS or JavaScript, returned as a per-field diff the author accepts or rejects one by one; nothing is saved

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | forms.publish |
| Grant level | view |
| Risk | low |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/forms/ask_diff |
| MCP tool | forms_ask_diff (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  instruction: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  changes: Array<{
      path: string;
      before: string;
      after: string;
    }>;
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
    "agentId": "agt_a1b2c3",
    "formId": "frm_a1b2c3",
    "instruction": "example"
  },
  "output": {
    "changes": [
      {
        "after": "example",
        "before": "example",
        "path": "example"
      }
    ]
  }
}
```
