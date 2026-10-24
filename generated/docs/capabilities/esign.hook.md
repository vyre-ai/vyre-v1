# esign.hook

Inbound provider webhook: sent, viewed, signed, declined

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
| HTTP | POST /hooks/esign |
| MCP tool | none |
| CLI | none |
| Emits | signature.viewed, signature.signed, signature.declined |

## Input

```ts
type In = {
  provider: "documenso" | "dropbox_sign" | "docusign";
  payload: unknown;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

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
    "payload": {},
    "provider": "documenso"
  },
  "output": {
    "ok": true
  }
}
```
