# access.policies.set

Set a policy value; applies last in the decision

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/policies/set |
| MCP tool | access_policies_set (engineer) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  key: string;
  scope: string;
  value: unknown;
};
```

## Output

```ts
type Out = {
  policy: {
    key: string;
    scope: string;
    kind: "gate" | "spend" | "limit" | "provider_label" | "retention" | "sign_in" | "sharing" | "vault";
    value: unknown;
    updatedAt: number;
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
    "key": "example",
    "scope": "space",
    "value": {}
  },
  "output": {
    "policy": {
      "key": "gate.send",
      "kind": "gate",
      "scope": "space",
      "updatedAt": 1760000000000,
      "value": {}
    }
  }
}
```
