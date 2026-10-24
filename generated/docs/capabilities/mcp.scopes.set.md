# mcp.scopes.set

Change the scopes of an outside actor (read, post in threads, read changesets, write on a branch with approval)

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/scopes/set |
| MCP tool | mcp_scopes_set (engineer) |
| CLI | none |
| Emits | mcp.scopes_changed |

## Input

```ts
type In = {
  actorId: string;
  scopes: {
    read: boolean;
    post: boolean;
    readChangesets: boolean;
    writeBranch: boolean;
  };
};
```

## Output

```ts
type Out = {
  scopes: {
    read: boolean;
    post: boolean;
    readChangesets: boolean;
    writeBranch: boolean;
  };
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
    "actorId": "act_a1b2c3",
    "scopes": {
      "post": true,
      "read": true,
      "readChangesets": true,
      "writeBranch": true
    }
  },
  "output": {
    "scopes": {
      "post": true,
      "read": true,
      "readChangesets": true,
      "writeBranch": true
    }
  }
}
```
