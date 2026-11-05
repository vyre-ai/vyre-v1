# github.me.complete

Finish connecting my GitHub: GitHub sent me back with a code; trade it, learn who I am on GitHub and keep the refresh token in my Vault

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/me/complete |
| MCP tool | none |
| CLI | none |
| Emits | github.me_connected |

## Input

```ts
type In = {
  code: string;
  state: string;
};
```

## Output

```ts
type Out = {
  login: string;
  source: "space" | "vyre";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example",
    "state": "example"
  },
  "output": {
    "login": "example",
    "source": "space"
  }
}
```
