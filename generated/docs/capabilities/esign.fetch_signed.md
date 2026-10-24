# esign.fetch_signed

Fetch the signed PDF and audit certificate into the record folder as a new version

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/esign/fetch_signed |
| MCP tool | esign_fetch_signed (files) |
| CLI | none |
| Emits | signature.signed |

## Input

```ts
type In = {
  envelopeId: string;
};
```

## Output

```ts
type Out = {
  fileId: string;
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
    "envelopeId": "env_a1b2c3"
  },
  "output": {
    "fileId": "fil_a1b2c3"
  }
}
```
