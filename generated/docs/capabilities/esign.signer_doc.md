# esign.signer_doc

Public: the PDF a signer signs, for a live link only

| | |
|---|---|
| Module | esign |
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
| Team Space only | yes |
| HTTP | POST /v1/esign/signer_doc |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  token: string;
  visitor: {
    ip?: string;
    ua?: string;
  };
};
```

## Output

```ts
type Out = {
  base64: string;
};
```

## Errors

- auth.bad_credentials
- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "token": "example",
    "visitor": {
      "ip": "example",
      "ua": "example"
    }
  },
  "output": {
    "base64": "example"
  }
}
```
