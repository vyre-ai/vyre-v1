# email_builder.snippets.save

Create or change a composer snippet

| | |
|---|---|
| Module | email-builder-api |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/email_builder/snippets/save |
| MCP tool | email_builder_snippets_save (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  snippetId?: string;
  name: string;
  body: string;
  shortcut?: string;
  shared?: boolean;
};
```

## Output

```ts
type Out = {
  snippet: {
    snippetId: string;
    name: string;
    body: string;
    shortcut?: string;
    shared: boolean;
    updatedAt: number;
  };
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
  "input": {
    "body": "example",
    "name": "example",
    "shared": true,
    "shortcut": "example",
    "snippetId": "snp_a1b2c3"
  },
  "output": {
    "snippet": {
      "body": "example",
      "name": "example",
      "shared": true,
      "shortcut": "example",
      "snippetId": "snp_a1b2c3",
      "updatedAt": 1760000000000
    }
  }
}
```
