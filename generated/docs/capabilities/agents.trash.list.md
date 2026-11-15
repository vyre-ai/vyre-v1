# agents.trash.list

The agents in Trash, with which are being deleted for good

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/agents/trash/list |
| MCP tool | agents_trash_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  agents: Array<{
      agentId: string;
      name: string;
      kind: "assistant" | "teammate" | "agent";
      ownerId: string;
      deletedAt: number;
      deleting: boolean;
      folderId?: string;
      failed?: string;
      erasesAt?: number;
      canDelete: boolean;
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
    "agents": [
      {
        "agentId": "agt_a1b2c3",
        "canDelete": true,
        "deletedAt": 1760000000000,
        "deleting": true,
        "erasesAt": 1760000000000,
        "failed": "example",
        "folderId": "fld_a1b2c3",
        "kind": "assistant",
        "name": "example",
        "ownerId": "usr_a1b2c3"
      }
    ]
  }
}
```
