# email_builder.snippets.list

List composer snippets: short reusable text for Inbox email and text replies, mine and shared with the Space

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
| HTTP | POST /v1/email_builder/snippets/list |
| MCP tool | email_builder_snippets_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  snippets: Array<{
      snippetId: string;
      name: string;
      body: string;
      shortcut?: string;
      shared: boolean;
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
    "snippets": [
      {
        "body": "example",
        "name": "example",
        "shared": true,
        "shortcut": "example",
        "snippetId": "snp_a1b2c3",
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
