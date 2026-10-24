# mcp.token.log_reveal

Log that a one-time token was revealed or copied in the connect sheet

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/token/log_reveal |
| MCP tool | mcp_token_log_reveal (engineer) |
| CLI | none |
| Emits | token.revealed |

## Input

```ts
type In = {
  tokenId: string;
  action: "reveal" | "copy";
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "action": "reveal",
    "tokenId": "tok_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
