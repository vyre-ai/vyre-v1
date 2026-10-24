# mcp.tools.list

Tools listed for this caller: about 60 by default; the rest are deferred and found with tool_search

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
| HTTP | POST /v1/mcp/tools/list |
| MCP tool | mcp_tools_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  toolset?: "records" | "files" | "memory" | "vault" | "automations" | "chats" | "inbox" | "sites" | "terminal" | "computer" | "agents" | "tasks" | "meta" | "engineer";
  includeDeferred?: boolean;
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
  total: number;
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
    "includeDeferred": true,
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
    ],
    "total": 1
  }
}
```
