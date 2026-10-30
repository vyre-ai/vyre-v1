# members.sign_in_github.get

The GitHub sign-in app: the client id, whether the secret is set (never the secret), where it comes from, and the callback address to register at GitHub

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
| HTTP | POST /v1/members/sign_in_github/get |
| MCP tool | members_sign_in_github_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
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
  "input": {},
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
