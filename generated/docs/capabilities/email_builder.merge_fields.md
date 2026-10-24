# email_builder.merge_fields

Merge fields available for a record type

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
| HTTP | POST /v1/email_builder/merge_fields |
| MCP tool | email_builder_merge_fields (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
};
```

## Output

```ts
type Out = {
  fields: Array<{
      key: string;
      title: string;
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
  "input": {
    "type": "contact"
  },
  "output": {
    "fields": [
      {
        "key": "example",
        "title": "example"
      }
    ]
  }
}
```
