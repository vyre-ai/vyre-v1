# forms.publish

Publish a form as a public link or embed

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | forms.publish |
| Grant level | manage |
| Risk | medium |
| Resource | form (/formId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | yes |
| HTTP | POST /v1/forms/publish |
| MCP tool | forms_publish (automations) |
| CLI | none |
| Emits | form.published |

## Input

```ts
type In = {
  formId: string;
};
```

## Output

```ts
type Out = {
  url: string;
  embed: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
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
    "embed": "example",
    "url": "example"
  }
}
```
