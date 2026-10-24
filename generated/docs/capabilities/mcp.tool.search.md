# mcp.tool.search

Find tools by what you want to do; returns names, summaries and schemas, then the tools are callable

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
| HTTP | POST /v1/mcp/tool/search |
| MCP tool | tool_search (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  query: string;
  toolset?: "records" | "files" | "memory" | "vault" | "automations" | "chats" | "inbox" | "sites" | "terminal" | "computer" | "agents" | "tasks" | "meta" | "engineer";
  limit?: number;
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
    "limit": 1,
    "query": "example",
    "toolset": "records"
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
