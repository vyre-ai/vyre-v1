# mcp.connected.link

The address to paste into an MCP app, and the one line for Claude Code

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/connected/link |
| MCP tool | mcp_connected_link (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  url: string;
  claudeCode: string;
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
    "claudeCode": "claude mcp add --transport http vyre https://northwind.vyre.run/mcp",
    "url": "https://northwind.vyre.run/mcp"
  }
}
```
