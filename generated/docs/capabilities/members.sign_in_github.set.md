# members.sign_in_github.set

Turn on GitHub sign-in: the OAuth app client id and secret; the secret goes into the Vault as a Space item and is never shown again

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
| HTTP | POST /v1/members/sign_in_github/set |
| MCP tool | members_sign_in_github_set (engineer) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  clientId: string;
  clientSecret?: string;
};
```

## Output

```ts
type Out = {
  github: {
    clientId?: string;
    secretSet: boolean;
    source: "env" | "space" | "none";
    callbackUrl: string;
    createUrl: string;
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
    "clientId": "example",
    "clientSecret": "example"
  },
  "output": {
    "github": {
      "callbackUrl": "example",
      "clientId": "example",
      "createUrl": "example",
      "secretSet": true,
      "source": "env"
    }
  }
}
```
