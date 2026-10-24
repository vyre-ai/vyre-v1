# vault.policy.get

The Space vault policy: who may export, longest pull link, Restricted never exported, reveal reasons

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | vault.policy |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/vault/policy/get |
| MCP tool | vault_policy_get (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  policy: {
    exportRoles: Array<string>;
    pullExpiryMax: "1h" | "1d" | "7d";
    blockRestrictedExport: true;
    revealNeedsReason: boolean;
  };
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
  "input": {},
  "output": {
    "policy": {
      "blockRestrictedExport": true,
      "exportRoles": [
        "example"
      ],
      "pullExpiryMax": "1h",
      "revealNeedsReason": true
    }
  }
}
```
