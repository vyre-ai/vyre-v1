# mcp.toolsets.list

Toolsets the caller may use (engineer needs engineer.mcp)

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/toolsets/list |
| MCP tool | mcp_toolsets_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  toolsets: Array<{
      toolset: "records" | "files" | "memory" | "vault" | "automations" | "chats" | "inbox" | "sites" | "terminal" | "computer" | "agents" | "tasks" | "meta" | "engineer";
      tools: number;
      listed: number;
      allowed: boolean;
    }>;
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
  "input": {},
  "output": {
    "toolsets": [
      {
        "allowed": true,
        "listed": 1,
        "tools": 1,
        "toolset": "records"
      }
    ]
  }
}
```
