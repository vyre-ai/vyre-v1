# esign.provider_set

Choose the default provider; Automations do not change

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/esign/provider_set |
| MCP tool | esign_provider_set (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  provider: "documenso" | "dropbox_sign" | "docusign";
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
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "provider": "documenso"
  },
  "output": {
    "ok": true
  }
}
```
