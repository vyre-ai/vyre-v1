# members.sign_in_policy.get

The Space sign-in policy: second-factor floor, SSO required, allowed methods

| | |
|---|---|
| Module | members |
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
| Team Space only | yes |
| HTTP | POST /v1/members/sign_in_policy/get |
| MCP tool | members_sign_in_policy_get (engineer) |
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
    secondFactor: "off" | "required";
    requireSso: boolean;
    allowPassword: boolean;
    allowGithub: boolean;
  };
  capabilities?: {
    password: boolean;
    github: boolean;
    sso: Array<string>;
    newMemberMfaEnrollment: boolean;
    ownerHasSecondFactor: boolean;
    currentHasSecondFactor: boolean;
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
    "capabilities": {
      "currentHasSecondFactor": true,
      "github": true,
      "newMemberMfaEnrollment": true,
      "ownerHasSecondFactor": true,
      "password": true,
      "sso": [
        "example"
      ]
    },
    "policy": {
      "allowGithub": true,
      "allowPassword": true,
      "requireSso": true,
      "secondFactor": "off"
    }
  }
}
```
