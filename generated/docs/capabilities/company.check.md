# company.check

Prove the key now in the Vault works, with no person involved. Answers what is wrong in plain words, or who it is; never the key. A key that works is remembered

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/company/check |
| MCP tool | company_check (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  ok: boolean;
  problem?: string;
  clientId?: string;
  who?: string;
  tenantId?: string;
  credential?: "certificate" | "secret";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "clientId": "example",
    "credential": "certificate",
    "ok": true,
    "problem": "example",
    "tenantId": "example",
    "who": "example"
  }
}
```
