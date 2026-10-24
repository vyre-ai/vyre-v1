# mcp.token.issue

Issue a one-time registration token for an outside agent: works once, within 10 minutes; reveal and copy are logged

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | channels.agents |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/token/issue |
| MCP tool | mcp_token_issue (meta) |
| CLI | none |
| Emits | token.issued |

## Input

```ts
type In = {
  name: string;
  kind: "claude_code" | "codex" | "other";
  channelId?: string;
  scopes?: {
    read: boolean;
    post: boolean;
    readChangesets: boolean;
    writeBranch: boolean;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  tokenId: string;
  oneTimeToken: string;
  expiresAt: number;
  mcpUrl: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "channelId": "chn_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "claude_code",
    "name": "Claude Code",
    "scopes": {
      "post": true,
      "read": true,
      "readChangesets": true,
      "writeBranch": true
    }
  },
  "output": {
    "tokenId": "tok_a1b2c3",
    "oneTimeToken": "otk_example",
    "expiresAt": 1760000600000,
    "mcpUrl": "https://northwind.example.com/mcp"
  }
}
```
