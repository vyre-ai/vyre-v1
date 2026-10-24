# vault.policy.set

Set the Space vault policy

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | vault.policy |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/vault/policy/set |
| MCP tool | vault_policy_set (vault) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  policy: {
    exportRoles: Array<string>;
    pullExpiryMax: "1h" | "1d" | "7d";
    blockRestrictedExport: true;
    revealNeedsReason: boolean;
  };
};
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
  "input": {
    "policy": {
      "blockRestrictedExport": true,
      "exportRoles": [
        "example"
      ],
      "pullExpiryMax": "1h",
      "revealNeedsReason": true
    }
  },
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
