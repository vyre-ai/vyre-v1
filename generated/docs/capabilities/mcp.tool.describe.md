# mcp.tool.describe

Full schema and examples of named tools

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
| HTTP | POST /v1/mcp/tool/describe |
| MCP tool | mcp_tool_describe (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  names: Array<string>;
};
```

## Output

```ts
type Out = {
  tools: Array<{
      name: string;
      summary: string;
      toolset: "records" | "files" | "memory" | "vault" | "automations" | "chats" | "inbox" | "sites" | "terminal" | "computer" | "agents" | "tasks" | "meta" | "engineer";
      deferred: boolean;
      input?: unknown;
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
  "input": {
    "names": [
      "example"
    ]
  },
  "output": {
    "tools": [
      {
        "deferred": true,
        "input": {},
        "name": "records_query",
        "summary": "example",
        "toolset": "records"
      }
    ]
  }
}
```
