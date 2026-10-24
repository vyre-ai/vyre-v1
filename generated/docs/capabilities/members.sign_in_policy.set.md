# members.sign_in_policy.set

Set the sign-in policy (owner floor: nobody goes below it)

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/sign_in_policy/set |
| MCP tool | members_sign_in_policy_set (engineer) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  policy: {
    secondFactor: "off" | "required";
    requireSso: boolean;
    allowPassword: boolean;
    allowGithub: boolean;
  };
};
```

## Output

```ts
type Out = {
  policy: {
    secondFactor: "off" | "required";
    requireSso: boolean;
    allowPassword: boolean;
    allowGithub: boolean;
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
      "allowGithub": true,
      "allowPassword": true,
      "requireSso": true,
      "secondFactor": "off"
    }
  },
  "output": {
    "policy": {
      "allowGithub": true,
      "allowPassword": true,
      "requireSso": true,
      "secondFactor": "off"
    }
  }
}
```
