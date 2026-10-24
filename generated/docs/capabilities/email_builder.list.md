# email_builder.list

List email designs (campaigns, inbox templates, automation steps share them)

| | |
|---|---|
| Module | email-builder-api |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/email_builder/list |
| MCP tool | email_builder_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  emails: Array<{
      emailId: string;
      name: string;
      updatedAt: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "emails": [
      {
        "emailId": "eml_a1b2c3",
        "name": "example",
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
