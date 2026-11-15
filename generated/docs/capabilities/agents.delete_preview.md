# agents.delete_preview

What deleting this agent for good would remove, with real counts, and what made by others names it and needs someone

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | manage |
| Risk | low |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/delete_preview |
| MCP tool | agents_delete_preview (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  agentId: string;
  name: string;
  kind: "assistant" | "teammate" | "agent";
  inTrash: boolean;
  chats: number;
  sharedChats: number;
  memory: number;
  bytes: number;
  routines: number;
  named: Array<{
      kind: "automation" | "task" | "goal" | "project";
      id: string;
      title: string;
      link: string;
    }>;
  chatPeople: Array<{
      id: string;
      name: string;
    }>;
  folderPeople: Array<{
      id: string;
      name: string;
    }>;
  backups: string;
  backupsKeptDays?: number;
  refused?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "agentId": "agt_a1b2c3",
    "backups": "example",
    "backupsKeptDays": 1,
    "bytes": 1,
    "chatPeople": [
      {
        "id": "usr_a1b2c3",
        "name": "example"
      }
    ],
    "chats": 1,
    "folderPeople": [
      {
        "id": "usr_a1b2c3",
        "name": "example"
      }
    ],
    "inTrash": true,
    "kind": "assistant",
    "memory": 1,
    "name": "example",
    "named": [
      {
        "id": "example",
        "kind": "automation",
        "link": "example",
        "title": "example"
      }
    ],
    "refused": "example",
    "routines": 1,
    "sharedChats": 1
  }
}
```
