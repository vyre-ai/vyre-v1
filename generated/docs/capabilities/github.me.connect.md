# github.me.connect

Start connecting my own GitHub: the address to send me to (the Space's own GitHub app when an admin set one up, else the default Vyre app), with PKCE. The refresh token ends up in my own Vault (Mine)

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
| HTTP | POST /v1/github/me/connect |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  return?: string;
};
```

## Output

```ts
type Out = {
  authUrl: string;
  state: string;
  source: "space" | "vyre";
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "return": "example"
  },
  "output": {
    "authUrl": "example",
    "source": "space",
    "state": "example"
  }
}
```
