# mcp.session.open

Open an MCP session from a registered token: resolves the actor, scopes and the toolsets it may list

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/session/open |
| MCP tool | none |
| CLI | none |
| Emits | mcp.session_started |

## Input

```ts
type In = {
  token: string;
  clientName?: string;
};
```

## Output

```ts
type Out = {
  sessionId: string;
  principal: string;
  actingFor?: string;
  scopes: {
    read: boolean;
    post: boolean;
    readChangesets: boolean;
    writeBranch: boolean;
  };
  toolsets: Array<"records" | "files" | "memory" | "vault" | "automations" | "chats" | "inbox" | "sites" | "terminal" | "computer" | "agents" | "tasks" | "meta" | "engineer">;
};
```

## Errors

- auth.expired
- auth.unauthenticated
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.revoked
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "clientName": "example",
    "token": "example"
  },
  "output": {
    "actingFor": "example",
    "principal": "example",
    "scopes": {
      "post": true,
      "read": true,
      "readChangesets": true,
      "writeBranch": true
    },
    "sessionId": "ses_a1b2c3",
    "toolsets": [
      "records"
    ]
  }
}
```
