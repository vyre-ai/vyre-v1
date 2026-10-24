# templates.install

Install a template (install sheet shown first)

| | |
|---|---|
| Module | templates |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.install |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/templates/install |
| MCP tool | templates_install (sites) |
| CLI | none |
| Emits | template.installed |

## Input

```ts
type In = {
  templateId: string;
  into?: string;
};
```

## Output

```ts
type Out = {
  installed: Array<{
      kind: string;
      id: string;
    }>;
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
    "into": "fld_a1b2c3",
    "templateId": "tpl_a1b2c3"
  },
  "output": {
    "installed": [
      {
        "id": "example",
        "kind": "example"
      }
    ]
  }
}
```
