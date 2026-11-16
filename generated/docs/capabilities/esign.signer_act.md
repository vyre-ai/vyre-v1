# esign.signer_act

Public: sign, decline or take a copy, by a signing link

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
| HTTP | POST /v1/esign/signer_act |
| MCP tool | none |
| CLI | none |
| Emits | signature.signed, signature.declined |

## Input

```ts
type In = {
  token: string;
  visitor: {
    ip?: string;
    ua?: string;
  };
  op: "sign" | "decline" | "copy";
  body?: unknown;
};
```

## Output

```ts
type Out = {
  result: unknown;
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
    "body": {},
    "op": "sign",
    "token": "example",
    "visitor": {
      "ip": "example",
      "ua": "example"
    }
  },
  "output": {
    "result": {}
  }
}
```
