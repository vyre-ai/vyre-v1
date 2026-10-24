# memory.restore_version

Restore a shared memory note to an earlier version (owners and admins)

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | file (/noteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/restore_version |
| MCP tool | memory_restore_version (memory) |
| CLI | none |
| Emits | memory.note_restored |

## Input

```ts
type In = {
  noteId: string;
  versionId: string;
};
```

## Output

```ts
type Out = {
  note: {
    noteId: string;
    path: string;
    title: string;
    layer: "person" | "agent" | "project" | "space";
    agentId?: string;
    updatedAt: number;
  };
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
    "noteId": "not_a1b2c3",
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "note": {
      "agentId": "agt_a1b2c3",
      "layer": "person",
      "noteId": "not_a1b2c3",
      "path": "Agents/Intake/memory/notes/clients.md",
      "title": "example",
      "updatedAt": 1760000000000
    }
  }
}
```
