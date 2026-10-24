# email_builder.versions

List saved versions

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
| HTTP | POST /v1/email_builder/versions |
| MCP tool | email_builder_versions (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  emailId: string;
};
```

## Output

```ts
type Out = {
  versions: Array<{
      version: number;
      at: number;
      by: string;
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
    "emailId": "eml_a1b2c3"
  },
  "output": {
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "version": 1
      }
    ]
  }
}
```
