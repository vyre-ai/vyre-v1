# documenso.create

Create an envelope at Documenso

| | |
|---|---|
| Module | documenso |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/documenso/create |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  signers: Array<{
      name: string;
      email: string;
    }>;
};
```

## Output

```ts
type Out = {
  remoteId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "signers": [
      {
        "email": "example",
        "name": "example"
      }
    ]
  },
  "output": {
    "remoteId": "example"
  }
}
```
