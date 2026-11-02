# google.dwd.check_key

Prove the service-account key in the Vault works, with no person involved: its shape, its signature, and that Google still knows it. Answers what is wrong in plain words; never the key

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/dwd/check_key |
| MCP tool | google_dwd_check_key (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  vaultItem: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  clientId?: string;
  clientEmail?: string;
  projectId?: string;
  problem?: string;
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
    "vaultItem": "#Dana_Lawmatics"
  },
  "output": {
    "clientEmail": "example",
    "clientId": "example",
    "ok": true,
    "problem": "example",
    "projectId": "example"
  }
}
```
