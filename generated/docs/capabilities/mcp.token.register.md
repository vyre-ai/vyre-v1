# mcp.token.register

Exchange a one-time token for a registered outside-actor token (called by the outside tool, not by a signed-in person)

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/token/register |
| MCP tool | none |
| CLI | none |
| Emits | token.registered |

## Input

```ts
type In = {
  oneTimeToken: string;
  clientName: string;
  clientVersion?: string;
};
```

## Output

```ts
type Out = {
  actorId: string;
  token: string;
  mcpUrl: string;
  scopes: {
    read: boolean;
    post: boolean;
    readChangesets: boolean;
    writeBranch: boolean;
  };
};
```

## Errors

- auth.expired
- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "clientName": "example",
    "clientVersion": "example",
    "oneTimeToken": "example"
  },
  "output": {
    "actorId": "act_a1b2c3",
    "token": "vyr_example",
    "mcpUrl": "https://northwind.example.com/mcp",
    "scopes": {
      "read": true,
      "post": true,
      "readChangesets": true,
      "writeBranch": false
    }
  }
}
```
