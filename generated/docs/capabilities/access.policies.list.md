# access.policies.list

List Space policies (Gate rules, spend, label rules, sign-in, sharing, retention, vault)

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/access/policies/list |
| MCP tool | access_policies_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind?: "gate" | "spend" | "limit" | "provider_label" | "retention" | "sign_in" | "sharing" | "vault";
};
```

## Output

```ts
type Out = {
  policies: Array<{
      key: string;
      scope: string;
      kind: "gate" | "spend" | "limit" | "provider_label" | "retention" | "sign_in" | "sharing" | "vault";
      value: unknown;
      updatedAt: number;
    }>;
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
    "kind": "gate"
  },
  "output": {
    "policies": [
      {
        "key": "gate.send",
        "kind": "gate",
        "scope": "space",
        "updatedAt": 1760000000000,
        "value": {}
      }
    ]
  }
}
```
