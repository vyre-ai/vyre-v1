# identity.github_link

Link a GitHub account so it can sign in once the Space is named

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/identity/github_link |
| MCP tool | identity_github_link (meta) |
| CLI | none |
| Emits | github.linked |

## Input

```ts
type In = {
  code: string;
};
```

## Output

```ts
type Out = {
  login: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example"
  },
  "output": {
    "login": "example"
  }
}
```
