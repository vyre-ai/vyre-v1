# esign.signer_view

Public: open a signing link. Records the open and returns what the signer sees

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
| Team Space only | yes |
| HTTP | POST /v1/esign/signer_view |
| MCP tool | none |
| CLI | none |
| Emits | signature.viewed |

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
  session: unknown;
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
    "session": {}
  }
}
```
