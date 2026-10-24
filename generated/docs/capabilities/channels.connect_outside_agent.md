# channels.connect_outside_agent

Connect an outside agent (Claude Code, Codex) to a channel: returns the MCP address, a one-time token (once, 10 minutes) and the run command

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | channels.agents |
| Grant level | manage |
| Risk | high |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/channels/connect_outside_agent |
| MCP tool | channels_connect_outside_agent (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channelId: string;
  name: string;
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
  mcpUrl: string;
  oneTimeToken: string;
  expiresAt: number;
  runCommand: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "channelId": "chn_a1b2c3",
    "idempotencyKey": "idem_1",
    "name": "Claude Code",
    "scopes": {
      "post": true,
      "read": true,
      "readChangesets": true,
      "writeBranch": true
    }
  },
  "output": {
    "mcpUrl": "https://northwind.example.com/mcp",
    "oneTimeToken": "otk_example",
    "expiresAt": 1760000600000,
    "runCommand": "claude mcp add vyre https://northwind.example.com/mcp --token otk_example"
  }
}
```
