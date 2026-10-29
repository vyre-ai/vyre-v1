# forms.design_set

Set layout, theme, fonts, the form source (custom HTML template, CSS and JavaScript), cover image, conditional logic and thank-you page or redirect

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
| HTTP | POST /v1/forms/design_set |
| MCP tool | forms_design_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  formId: string;
  theme?: Record<string, unknown>;
  css?: string;
  html?: string;
  js?: string;
  logic?: unknown;
  thankYou?: {
    text?: string;
    redirect?: string;
  };
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "css": "example",
    "formId": "frm_a1b2c3",
    "html": "example",
    "js": "example",
    "logic": {},
    "thankYou": {
      "redirect": "example",
      "text": "example"
    },
    "theme": {}
  },
  "output": {
    "ok": true
  }
}
```
